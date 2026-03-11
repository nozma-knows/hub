import { randomUUID } from "node:crypto";

import { and, eq, isNull, lt, or } from "drizzle-orm";

import { hubSkillInstalls } from "@/db/schema";
import { db } from "@/lib/db";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);


const installerKey = Symbol.for("openclaw-hub.skill-installer.interval");

type GlobalInstaller = typeof globalThis & {
  [installerKey]?: NodeJS.Timeout;
};

const INTERVAL_MS = Number(process.env.HUB_SKILL_INSTALLER_INTERVAL_MS ?? 15_000);
const MAX_PER_TICK = Number(process.env.HUB_SKILL_INSTALLER_MAX_PER_TICK ?? 1);
const LOCK_TTL_MS = Number(process.env.HUB_SKILL_INSTALLER_LOCK_TTL_MS ?? 10 * 60_000);
const MAX_ATTEMPTS = Number(process.env.HUB_SKILL_INSTALLER_MAX_ATTEMPTS ?? 2);

function enabled() {
  return (process.env.HUB_SKILL_INSTALLER_ENABLED ?? "true").toLowerCase() === "true";
}

function installEnabled() {
  return (process.env.HUB_SKILL_INSTALL_ENABLED ?? "false").toLowerCase() === "true";
}

export function startSkillInstaller(): void {
  if (!enabled()) {
    // eslint-disable-next-line no-console
    console.log("⏸️ Skill installer disabled (HUB_SKILL_INSTALLER_ENABLED=false)");
    return;
  }

  const g = globalThis as GlobalInstaller;
  if (g[installerKey]) return;

  // eslint-disable-next-line no-console
  console.log(`🧩 Starting Hub skill installer (interval=${INTERVAL_MS}ms)`);

  let isRunning = false;

  const tick = async () => {
    if (isRunning) return;
    isRunning = true;

    try {
      const now = new Date();
      const lockExpiresAt = new Date(Date.now() + LOCK_TTL_MS);

      // Find candidates: queued installs, plus "installing" installs whose lock expired (crash/restart recovery).
      const candidates = await db.query.hubSkillInstalls.findMany({
        where: and(
          or(eq(hubSkillInstalls.status, "queued"), eq(hubSkillInstalls.status, "installing")),
          or(isNull(hubSkillInstalls.lockExpiresAt), lt(hubSkillInstalls.lockExpiresAt, now))
        ),
        orderBy: (t, { asc }) => [asc(t.updatedAt)],
        limit: 10
      });

      const due = candidates
        .filter((c) => (c.attempts ?? 0) < MAX_ATTEMPTS)
        .slice(0, MAX_PER_TICK);

      for (const row of due) {
        const lockId = randomUUID();

        const [locked] = await db
          .update(hubSkillInstalls)
          .set({
            status: "installing",
            statusDetail: "Starting…",
            progress: 5,
            lockId,
            lockExpiresAt,
            installStartedAt: row.installStartedAt ?? new Date(),
            attempts: (row.attempts ?? 0) + 1,
            error: null,
            updatedAt: new Date()
          })
          .where(
            and(
              eq(hubSkillInstalls.id, row.id),
              or(eq(hubSkillInstalls.status, "queued"), eq(hubSkillInstalls.status, "installing")),
              or(isNull(hubSkillInstalls.lockExpiresAt), lt(hubSkillInstalls.lockExpiresAt, now))
            )
          )
          .returning();

        if (!locked) continue;

        if (!installEnabled()) {
          await db
            .update(hubSkillInstalls)
            .set({
              status: "failed",
              statusDetail: "Install disabled",
              progress: 100,
              error: "Install disabled (set HUB_SKILL_INSTALL_ENABLED=true)",
              finishedAt: new Date(),
              lockId: null,
              lockExpiresAt: null,
              updatedAt: new Date()
            })
            .where(and(eq(hubSkillInstalls.id, row.id), eq(hubSkillInstalls.lockId, lockId)));
          continue;
        }

        if (!row.installSpec) {
          await db
            .update(hubSkillInstalls)
            .set({
              status: "failed",
              statusDetail: "Missing install spec",
              progress: 100,
              error: "Missing installSpec for skill",
              finishedAt: new Date(),
              lockId: null,
              lockExpiresAt: null,
              updatedAt: new Date()
            })
            .where(and(eq(hubSkillInstalls.id, row.id), eq(hubSkillInstalls.lockId, lockId)));
          continue;
        }

        try {
          await db
            .update(hubSkillInstalls)
            .set({ statusDetail: "Installing via Clawhub…", progress: 25, updatedAt: new Date() })
            .where(and(eq(hubSkillInstalls.id, row.id), eq(hubSkillInstalls.lockId, lockId)));

          const slug = row.clawhubSkillId;
          const workdir = process.env.OPENCLAW_WORKDIR ?? "/root/.openclaw";
          const dir = process.env.OPENCLAW_SKILLS_DIR ?? "skills";
          const cliSpec = process.env.HUB_CLAWHUB_CLI_SPEC ?? "clawhub@latest";

          const baseArgs = [
            "--bun",
            cliSpec,
            "install",
            slug,
            "--workdir",
            workdir,
            "--dir",
            dir,
            "--no-input"
          ];
          if (row.version?.trim()) {
            baseArgs.push("--version", row.version.trim());
          }

          const maxRetries = Number(process.env.HUB_SKILL_INSTALLER_RATE_LIMIT_RETRIES ?? 4);
          const baseDelayMs = Number(process.env.HUB_SKILL_INSTALLER_RATE_LIMIT_BASE_DELAY_MS ?? 1500);

          let combinedLogs = "";
          let attempt = 0;

          while (true) {
            attempt++;
            await db
              .update(hubSkillInstalls)
              .set({
                statusDetail: attempt === 1 ? "Downloading…" : `Retrying after rate limit… (attempt ${attempt})`,
                progress: Math.min(90, 25 + attempt * 10),
                updatedAt: new Date()
              })
              .where(and(eq(hubSkillInstalls.id, row.id), eq(hubSkillInstalls.lockId, lockId)));

            try {
              const res: any = await execFileAsync("bunx", baseArgs, {
                timeout: 10 * 60_000,
                maxBuffer: 8 * 1024 * 1024
              });
              const stdout = String(res?.stdout ?? "");
              const stderr = String(res?.stderr ?? "");
              combinedLogs += `\n\n--- attempt ${attempt} ---\n` + stdout + (stderr ? `\n[stderr]\n${stderr}` : "");

              await db
                .update(hubSkillInstalls)
                .set({
                  status: "installed",
                  statusDetail: "Installed",
                  progress: 100,
                  error: null,
                  logs: combinedLogs.trim().slice(0, 50_000),
                  installedAt: new Date(),
                  finishedAt: new Date(),
                  lockId: null,
                  lockExpiresAt: null,
                  updatedAt: new Date()
                })
                .where(and(eq(hubSkillInstalls.id, row.id), eq(hubSkillInstalls.lockId, lockId)));

              break;
            } catch (err: any) {
              const stdout = String(err?.stdout ?? "");
              const stderr = String(err?.stderr ?? "");
              const msg = String(err?.message ?? err);
              const out = (stdout + "\n" + stderr + "\n" + msg).trim();
              combinedLogs += `\n\n--- attempt ${attempt} ---\n` + out;

              const isRateLimited = /rate\s*limit\s*exceeded/i.test(out);
              const canRetry = isRateLimited && attempt <= maxRetries;

              if (!canRetry) {
                const status = isRateLimited ? "rate_limited" : "failed";
                const errorText = isRateLimited
                  ? "Rate limit exceeded. Please wait a bit and retry."
                  : msg;

                await db
                  .update(hubSkillInstalls)
                  .set({
                    status,
                    statusDetail: isRateLimited ? "Rate limited" : "Install failed",
                    progress: 100,
                    error: errorText.slice(0, 4000),
                    logs: combinedLogs.trim().slice(0, 50_000),
                    finishedAt: new Date(),
                    lockId: null,
                    lockExpiresAt: null,
                    updatedAt: new Date()
                  })
                  .where(and(eq(hubSkillInstalls.id, row.id), eq(hubSkillInstalls.lockId, lockId)));

                break;
              }

              const jitter = Math.floor(Math.random() * 500);
              const delay = baseDelayMs * Math.pow(2, attempt - 1) + jitter;
              await new Promise((r) => setTimeout(r, delay));
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);

          await db
            .update(hubSkillInstalls)
            .set({
              status: "failed",
              statusDetail: "Install failed",
              progress: 100,
              error: msg.slice(0, 4000),
              finishedAt: new Date(),
              lockId: null,
              lockExpiresAt: null,
              updatedAt: new Date()
            })
            .where(and(eq(hubSkillInstalls.id, row.id), eq(hubSkillInstalls.lockId, lockId)));
        }
      }

      // Mark installs that exceeded attempt budget as failed.
      const exhausted = candidates.filter((c) => (c.attempts ?? 0) >= MAX_ATTEMPTS);
      for (const row of exhausted) {
        await db
          .update(hubSkillInstalls)
          .set({
            status: "failed",
            statusDetail: "Too many attempts",
            progress: 100,
            error: row.error ?? `Install exceeded max attempts (${MAX_ATTEMPTS})`,
            finishedAt: row.finishedAt ?? new Date(),
            lockId: null,
            lockExpiresAt: null,
            updatedAt: new Date()
          })
          .where(and(eq(hubSkillInstalls.id, row.id), eq(hubSkillInstalls.status, "installing")));
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("🧩 Skill installer tick failed", err);
    } finally {
      isRunning = false;
    }
  };

  void tick();
  g[installerKey] = setInterval(() => void tick(), INTERVAL_MS);
}

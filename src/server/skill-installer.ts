import { randomUUID } from "node:crypto";

import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

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

// Cross-process throttling: only one install per (workspace, host) at a time.
const WORKSPACE_MUTEX_ENABLED =
  (process.env.HUB_SKILL_INSTALLER_WORKSPACE_MUTEX_ENABLED ?? "true").toLowerCase() === "true";
const HOST_MUTEX_KEY = process.env.HUB_SKILL_INSTALLER_HOST_MUTEX_KEY ?? "default";

function lockKeyParts(workspaceId: string) {
  // pg_advisory_lock takes bigint or two int4. We'll hash into two int4s.
  // This isn't cryptographic; it's just to create a stable lock key.
  const s = `hub-skill-install:${HOST_MUTEX_KEY}:${workspaceId}`;
  let h1 = 0;
  let h2 = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = (h1 * 31 + c) | 0;
    h2 = (h2 * 131 + c) | 0;
  }
  return { k1: h1, k2: h2 };
}

async function withWorkspaceMutex<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  if (!WORKSPACE_MUTEX_ENABLED) return fn();
  const { k1, k2 } = lockKeyParts(workspaceId);

  const res = await db.execute<{ ok: boolean }>(sql`select pg_try_advisory_lock(${k1}, ${k2}) as ok`);
  const ok = Boolean((res.rows as any[])?.[0]?.ok);
  if (!ok) {
    // Another Hub process is already installing a skill for this workspace/host.
    throw Object.assign(new Error("workspace_install_mutex_busy"), { code: "MUTEX_BUSY" });
  }

  try {
    return await fn();
  } finally {
    await db.execute(sql`select pg_advisory_unlock(${k1}, ${k2})`);
  }
}

function parseRetryAfterMs(output: string): number | null {
  // Best-effort parsing: clawhub may print human text, or proxy errors might include Retry-After.
  // Examples we try to catch:
  // - "Retry-After: 30"
  // - "retry after 30s"
  // - "try again in 2m"
  const m1 = output.match(/retry-after\s*:\s*(\d{1,6})/i);
  if (m1) return Number(m1[1]) * 1000;
  const m2 = output.match(/retry\s+after\s+(\d{1,6})\s*s/i);
  if (m2) return Number(m2[1]) * 1000;
  const m3 = output.match(/try\s+again\s+in\s+(\d{1,6})\s*s/i);
  if (m3) return Number(m3[1]) * 1000;
  const m4 = output.match(/try\s+again\s+in\s+(\d{1,6})\s*m/i);
  if (m4) return Number(m4[1]) * 60_000;
  return null;
}

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
        limit: 10,
      });

      const due = candidates.filter((c) => (c.attempts ?? 0) < MAX_ATTEMPTS).slice(0, MAX_PER_TICK);

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
            updatedAt: new Date(),
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
              updatedAt: new Date(),
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
              updatedAt: new Date(),
            })
            .where(and(eq(hubSkillInstalls.id, row.id), eq(hubSkillInstalls.lockId, lockId)));
          continue;
        }

        try {
          await db
            .update(hubSkillInstalls)
            .set({ statusDetail: "Installing via Clawhub…", progress: 25, updatedAt: new Date() })
            .where(and(eq(hubSkillInstalls.id, row.id), eq(hubSkillInstalls.lockId, lockId)));

          await withWorkspaceMutex(row.workspaceId, async () => {
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
              "--no-input",
            ];
            if (row.version?.trim()) {
              baseArgs.push("--version", row.version.trim());
            }

            const maxRetries = Number(process.env.HUB_SKILL_INSTALLER_RATE_LIMIT_RETRIES ?? 4);
            const baseDelayMs = Number(process.env.HUB_SKILL_INSTALLER_RATE_LIMIT_BASE_DELAY_MS ?? 1500);

            // Optional ClawHub auth/env passthrough (best-effort; harmless if ignored by CLI)
            const clawhubToken = process.env.HUB_CLAWHUB_TOKEN?.trim();
            const extraEnv: Record<string, string> = {};
            if (clawhubToken) extraEnv.CLAWHUB_TOKEN = clawhubToken;
            if (process.env.HUB_CLAWHUB_REGISTRY?.trim())
              extraEnv.CLAWHUB_REGISTRY = process.env.HUB_CLAWHUB_REGISTRY.trim();

            let combinedLogs = "";
            let attempt = 0;

            while (true) {
              attempt++;
              await db
                .update(hubSkillInstalls)
                .set({
                  statusDetail:
                    attempt === 1 ? "Downloading…" : `Retrying after rate limit… (attempt ${attempt})`,
                  progress: Math.min(90, 25 + attempt * 10),
                  updatedAt: new Date(),
                })
                .where(and(eq(hubSkillInstalls.id, row.id), eq(hubSkillInstalls.lockId, lockId)));

              const t0 = Date.now();
              try {
                const res: any = await execFileAsync("bunx", baseArgs, {
                  timeout: 10 * 60_000,
                  maxBuffer: 8 * 1024 * 1024,
                  env: { ...process.env, ...extraEnv },
                });
                const durationMs = Date.now() - t0;

                const stdout = String(res?.stdout ?? "");
                const stderr = String(res?.stderr ?? "");
                combinedLogs +=
                  `\n\n--- attempt ${attempt} ---\n` + stdout + (stderr ? `\n[stderr]\n${stderr}` : "");

                await db
                  .update(hubSkillInstalls)
                  .set({
                    status: "installed",
                    statusDetail: "Installed",
                    progress: 100,
                    error: null,
                    logs: combinedLogs.trim().slice(0, 50_000),
                    lastExitCode: 0,
                    lastDurationMs: durationMs,
                    lastRateLimitRetryAfterMs: null,
                    installedAt: new Date(),
                    finishedAt: new Date(),
                    lockId: null,
                    lockExpiresAt: null,
                    updatedAt: new Date(),
                  })
                  .where(and(eq(hubSkillInstalls.id, row.id), eq(hubSkillInstalls.lockId, lockId)));

                break;
              } catch (err: any) {
                const durationMs = Date.now() - t0;
                const exitCode = Number.isFinite(err?.code) ? Number(err.code) : null;

                const stdout = String(err?.stdout ?? "");
                const stderr = String(err?.stderr ?? "");
                const msg = String(err?.message ?? err);
                const out = (stdout + "\n" + stderr + "\n" + msg).trim();
                combinedLogs += `\n\n--- attempt ${attempt} ---\n` + out;

                const isRateLimited = /rate\s*limit\s*exceeded/i.test(out);
                const parsedRetryAfterMs = isRateLimited ? parseRetryAfterMs(out) : null;
                const canRetry = isRateLimited && attempt <= maxRetries;

                if (!canRetry) {
                  const status = isRateLimited ? "rate_limited" : "failed";
                  const errorText = isRateLimited ? "Rate limit exceeded. Please wait a bit and retry." : msg;

                  await db
                    .update(hubSkillInstalls)
                    .set({
                      status,
                      statusDetail: isRateLimited ? "Rate limited" : "Install failed",
                      progress: 100,
                      error: errorText.slice(0, 4000),
                      logs: combinedLogs.trim().slice(0, 50_000),
                      lastExitCode: exitCode,
                      lastDurationMs: durationMs,
                      lastRateLimitRetryAfterMs: parsedRetryAfterMs,
                      finishedAt: new Date(),
                      lockId: null,
                      lockExpiresAt: null,
                      updatedAt: new Date(),
                    })
                    .where(and(eq(hubSkillInstalls.id, row.id), eq(hubSkillInstalls.lockId, lockId)));

                  break;
                }

                const jitter = Math.floor(Math.random() * 500);
                const delay = parsedRetryAfterMs ?? baseDelayMs * Math.pow(2, attempt - 1) + jitter;

                await db
                  .update(hubSkillInstalls)
                  .set({
                    statusDetail: parsedRetryAfterMs
                      ? `Rate limited — waiting ${Math.ceil(delay / 1000)}s… (attempt ${attempt})`
                      : `Rate limited — backing off… (attempt ${attempt})`,
                    lastExitCode: exitCode,
                    lastDurationMs: durationMs,
                    lastRateLimitRetryAfterMs: parsedRetryAfterMs,
                    updatedAt: new Date(),
                  })
                  .where(and(eq(hubSkillInstalls.id, row.id), eq(hubSkillInstalls.lockId, lockId)));

                await new Promise((r) => setTimeout(r, delay));
              }
            }
          });
        } catch (err) {
          const isMutexBusy =
            (err as any)?.code === "MUTEX_BUSY" ||
            String((err as any)?.message ?? "") === "workspace_install_mutex_busy";
          const msg = isMutexBusy
            ? "Another install is already running for this workspace. Please wait and retry."
            : err instanceof Error
              ? err.message
              : String(err);

          await db
            .update(hubSkillInstalls)
            .set({
              status: isMutexBusy ? "queued" : "failed",
              statusDetail: isMutexBusy ? "Throttled" : "Install failed",
              progress: isMutexBusy ? 0 : 100,
              error: isMutexBusy ? null : msg.slice(0, 4000),
              finishedAt: isMutexBusy ? null : new Date(),
              lockId: null,
              lockExpiresAt: null,
              updatedAt: new Date(),
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
            updatedAt: new Date(),
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

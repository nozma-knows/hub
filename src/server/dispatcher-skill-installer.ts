import { randomUUID } from "node:crypto";

import { and, eq, isNull, lt, or } from "drizzle-orm";

import { hubSkillInstalls } from "@/db/schema";
import { db } from "@/lib/db";

const SKILL_INSTALL_LOCK_TTL_MS = Number(process.env.HUB_SKILL_INSTALL_LOCK_TTL_MS ?? 15 * 60_000);
const SKILL_INSTALL_MAX_PER_TICK = Number(process.env.HUB_SKILL_INSTALL_MAX_PER_TICK ?? 1);

export async function runSkillInstallerTick() {
  const now = new Date();
  const lockExpiresAt = new Date(Date.now() + SKILL_INSTALL_LOCK_TTL_MS);

  const candidates = await db.query.hubSkillInstalls.findMany({
    where: and(
      or(eq(hubSkillInstalls.status, "queued"), eq(hubSkillInstalls.status, "installing")),
      or(isNull(hubSkillInstalls.lockExpiresAt), lt(hubSkillInstalls.lockExpiresAt, now))
    ),
    orderBy: (t, { asc }) => [asc(t.updatedAt)],
    limit: 10,
  });

  const due = candidates.slice(0, SKILL_INSTALL_MAX_PER_TICK);
  if (due.length === 0) return;

  for (const row of due) {
    const lockId = randomUUID();

    const updated = await db
      .update(hubSkillInstalls)
      .set({
        status: "installing",
        statusDetail: "Installing",
        progress: 10,
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
          or(isNull(hubSkillInstalls.lockExpiresAt), lt(hubSkillInstalls.lockExpiresAt, now))
        )
      )
      .returning();

    if (!updated || updated.length === 0) continue;

    const slug = row.clawhubSkillId;
    const version = row.version?.trim() || "";

    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);

      // Install into OpenClaw managed skills dir (~/.openclaw/skills)
      const workdir = "/root/.openclaw";
      const args = ["--bun", "clawhub@latest", "install", slug, "--workdir", workdir, "--dir", "skills", "--no-input"];
      if (version) args.push("--version", version);

      await db
        .update(hubSkillInstalls)
        .set({ statusDetail: "Downloading/Installing", progress: 30, updatedAt: new Date() })
        .where(and(eq(hubSkillInstalls.id, row.id), eq(hubSkillInstalls.lockId, lockId)));

      const res: any = await execFileAsync("bunx", args, {
        timeout: 10 * 60_000,
        maxBuffer: 5 * 1024 * 1024,
      });

      const out = String(res?.stdout ?? "");
      const err = String(res?.stderr ?? "");
      const logs = (out + "\n" + err).trim().slice(-20_000);

      await db
        .update(hubSkillInstalls)
        .set({
          status: "installed",
          statusDetail: "Installed",
          progress: 100,
          logs,
          installedAt: new Date(),
          finishedAt: new Date(),
          lockId: null,
          lockExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(and(eq(hubSkillInstalls.id, row.id), eq(hubSkillInstalls.lockId, lockId)));
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      const out = String((err as any)?.stdout ?? "");
      const eout = String((err as any)?.stderr ?? "");
      const logs = (out + "\n" + eout).trim().slice(-20_000);

      const isRateLimited = /rate limit/i.test(msg) || /rate limit/i.test(logs);
      if (isRateLimited && (row.attempts ?? 0) < 2) {
        // Backoff: re-queue and don't pick it up again until lockExpiresAt.
        const backoffMs = 10 * 60_000;
        await db
          .update(hubSkillInstalls)
          .set({
            status: "queued",
            statusDetail: `Rate limited — retrying in ${Math.round(backoffMs / 60_000)}m`,
            progress: 0,
            error: msg.slice(0, 2_000),
            logs: logs || null,
            lockId: null,
            lockExpiresAt: new Date(Date.now() + backoffMs),
            updatedAt: new Date(),
          })
          .where(and(eq(hubSkillInstalls.id, row.id), eq(hubSkillInstalls.lockId, lockId)));
        continue;
      }

      await db
        .update(hubSkillInstalls)
        .set({
          status: "failed",
          statusDetail: "Failed",
          progress: 100,
          error: msg.slice(0, 8_000),
          logs: logs || null,
          finishedAt: new Date(),
          lockId: null,
          lockExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(and(eq(hubSkillInstalls.id, row.id), eq(hubSkillInstalls.lockId, lockId)));
    }
  }
}

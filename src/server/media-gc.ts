import { and, eq, isNull, lt } from "drizzle-orm";
import { unlink } from "node:fs/promises";
import path from "node:path";

import { hubMessageAttachments } from "@/db/schema";
import { db } from "@/lib/db";

function envInt(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

async function cleanupOnce(): Promise<void> {
  const ttlHours = envInt("HUB_MEDIA_UNATTACHED_TTL_HOURS", 24);
  const maxPerRun = envInt("HUB_MEDIA_GC_MAX_PER_RUN", 200);
  const mediaDir = process.env.HUB_MEDIA_DIR ?? "/root/.openclaw/hub-media";

  const cutoff = new Date(Date.now() - ttlHours * 60 * 60 * 1000);

  const candidates = await db
    .select({
      id: hubMessageAttachments.id,
      workspaceId: hubMessageAttachments.workspaceId,
      storagePath: hubMessageAttachments.storagePath
    })
    .from(hubMessageAttachments)
    .where(and(isNull(hubMessageAttachments.messageId), lt(hubMessageAttachments.createdAt, cutoff)))
    .limit(maxPerRun);

  if (candidates.length === 0) return;

  for (const att of candidates) {
    const full = path.join(mediaDir, att.storagePath);
    try {
      await unlink(full);
    } catch {
      // best-effort: file may already be gone
    }

    await db
      .delete(hubMessageAttachments)
      .where(and(eq(hubMessageAttachments.workspaceId, att.workspaceId), eq(hubMessageAttachments.id, att.id)));
  }

  // eslint-disable-next-line no-console
  console.log(`[media-gc] deleted ${candidates.length} unattached uploads older than ${ttlHours}h`);
}

export function startMediaGc(): void {
  const everyMinutes = envInt("HUB_MEDIA_GC_EVERY_MINUTES", 10);
  const jitterMs = envInt("HUB_MEDIA_GC_JITTER_MS", 5_000);

  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await cleanupOnce();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[media-gc] failed", e);
    } finally {
      running = false;
    }
  };

  // initial run (jittered)
  setTimeout(tick, Math.floor(Math.random() * jitterMs));
  setInterval(tick, everyMinutes * 60 * 1000);
}

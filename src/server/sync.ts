import { agents } from "@/db/schema";
import { db } from "@/lib/db";
import { openClawAdapter } from "@/lib/openclaw/adapter";

const SYNC_INTERVAL_MS = 1000 * 60 * 5;
const syncKey = Symbol.for("openclaw-hub.sync.interval");

type GlobalSync = typeof globalThis & {
  [syncKey]?: NodeJS.Timeout;
};

export function startReconciliationSync(): void {
  const globalSync = globalThis as GlobalSync;
  if (globalSync[syncKey]) {
    return;
  }

  const run = async () => {
    try {
      const live = await openClawAdapter.listAgents();
      await Promise.all(
        live.map((agent) =>
          db
            .insert(agents)
            .values({
              id: agent.id,
              name: agent.name,
              status: agent.status,
              openclawVersion: agent.version,
              behaviorChecksum: agent.behaviorChecksum,
              lastSyncedAt: new Date(),
              updatedAt: new Date()
            })
            .onConflictDoUpdate({
              target: agents.id,
              set: {
                name: agent.name,
                status: agent.status,
                openclawVersion: agent.version,
                behaviorChecksum: agent.behaviorChecksum,
                lastSyncedAt: new Date(),
                updatedAt: new Date()
              }
            })
        )
      );
    } catch {
      // keep scheduler alive even if OpenClaw temporarily fails
    }
  };

  void run();
  globalSync[syncKey] = setInterval(() => {
    void run();
  }, SYNC_INTERVAL_MS);
}

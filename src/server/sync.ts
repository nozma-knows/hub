import { and, eq, inArray, notInArray } from "drizzle-orm";

import { agents } from "@/db/schema";
import { db } from "@/lib/db";
import { openClawAdapter } from "@/lib/openclaw/adapter";
import { openClawCliAdapter } from "@/lib/openclaw/cli-adapter";

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

  console.log("🔄 Starting OpenClaw reconciliation sync...");

  const run = async () => {
    try {
      const live = await openClawCliAdapter.listAgents();
      const workspaceRows = await db.query.workspaces.findMany({
        columns: {
          id: true
        }
      });

      await Promise.all(
        workspaceRows.map(async (workspace) => {
          await Promise.all(
            live.map((agent) =>
              db
                .insert(agents)
                .values({
                  id: agent.id,
                  workspaceId: workspace.id,
                  name: agent.name,
                  status: agent.status,
                  openclawVersion: agent.version,
                  behaviorChecksum: agent.behaviorChecksum,
                  isRemoved: false,
                  removedAt: null,
                  lastSeenUpstreamAt: new Date(),
                  lastSyncedAt: new Date(),
                  updatedAt: new Date()
                })
                .onConflictDoUpdate({
                  target: agents.id,
                  set: {
                    workspaceId: workspace.id,
                    name: agent.name,
                    status: agent.status,
                    openclawVersion: agent.version,
                    behaviorChecksum: agent.behaviorChecksum,
                    isRemoved: false,
                    removedAt: null,
                    lastSeenUpstreamAt: new Date(),
                    lastSyncedAt: new Date(),
                    updatedAt: new Date()
                  }
                })
            )
          );

          const existing = await db.query.agents.findMany({
            where: and(eq(agents.workspaceId, workspace.id), eq(agents.isRemoved, false)),
            columns: {
              id: true
            }
          });
          const existingIds = existing.map((row) => row.id);
          const liveIds = live.map((agent) => agent.id);

          if (existingIds.length === 0) {
            return;
          }

          if (liveIds.length === 0) {
            await db
              .update(agents)
              .set({
                isRemoved: true,
                removedAt: new Date(),
                updatedAt: new Date()
              })
              .where(and(eq(agents.workspaceId, workspace.id), inArray(agents.id, existingIds)));
            return;
          }

          await db
            .update(agents)
            .set({
              isRemoved: true,
              removedAt: new Date(),
              updatedAt: new Date()
            })
            .where(
              and(
                eq(agents.workspaceId, workspace.id),
                inArray(agents.id, existingIds),
                notInArray(agents.id, liveIds)
              )
            );
        })
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

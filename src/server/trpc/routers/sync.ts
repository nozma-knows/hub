import { z } from "zod";
import { publicProcedure, createTrpcRouter } from "../init";

export const syncRouter = createTrpcRouter({
  manualSync: publicProcedure.mutation(async () => {
    try {
      // Only import what we need to avoid circuit breaker issues
      const { openClawCliAdapter } = await import("@/lib/openclaw/cli-adapter");
      const { db } = await import("@/lib/db");
      const { agents } = await import("@/db/schema");
      
      console.log("🔄 Starting isolated manual sync...");
      
      // Get live agents from CLI only
      const liveAgents = await openClawCliAdapter.listAgents();
      console.log(`📡 Found ${liveAgents.length} live agents:`, liveAgents.map(a => `${a.name}(${a.id})`));
      
      // Get the default workspace
      const workspaceRows = await db.query.workspaces.findMany({
        columns: { id: true, name: true }
      });
      
      if (workspaceRows.length === 0) {
        throw new Error("No workspaces found in database");
      }
      
      const defaultWorkspace = workspaceRows[0];
      console.log(`🏢 Using workspace: ${defaultWorkspace.id}`);
      
      let syncedCount = 0;
      
      // Insert each live agent
      for (const agent of liveAgents) {
        try {
          await db
            .insert(agents)
            .values({
              id: agent.id,
              workspaceId: defaultWorkspace.id,
              name: agent.name,
              status: agent.status,
              openclawVersion: agent.version || null,
              behaviorChecksum: agent.behaviorChecksum || null,
              isRemoved: false,
              removedAt: null,
              lastSeenUpstreamAt: new Date(),
              lastSyncedAt: new Date(),
              updatedAt: new Date()
            })
            .onConflictDoUpdate({
              target: agents.id,
              set: {
                name: agent.name,
                status: agent.status,
                openclawVersion: agent.version || null,
                behaviorChecksum: agent.behaviorChecksum || null,
                isRemoved: false,
                removedAt: null,
                lastSeenUpstreamAt: new Date(),
                lastSyncedAt: new Date(),
                updatedAt: new Date()
              }
            });
          
          console.log(`✅ Synced agent: ${agent.name} (${agent.id})`);
          syncedCount++;
          
        } catch (agentError) {
          console.error(`❌ Failed to sync agent ${agent.id}:`, agentError);
        }
      }
      
      console.log(`🎉 Sync complete! Synced ${syncedCount}/${liveAgents.length} agents`);
      
      return {
        success: true,
        message: `Successfully synced ${syncedCount} agents to workspace ${defaultWorkspace.id}`,
        agentCount: syncedCount,
        agentNames: liveAgents.map(a => a.name)
      };
      
    } catch (error) {
      console.error("❌ Manual sync failed:", error);
      throw new Error(`Manual sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }),

  checkSyncStatus: publicProcedure.query(async () => {
    try {
      const { db } = await import("@/lib/db");
      const { openClawCliAdapter } = await import("@/lib/openclaw/cli-adapter");
      
      // Count agents in database
      const dbAgents = await db.query.agents.findMany({
        where: (agents, { eq }) => eq(agents.isRemoved, false),
        columns: { id: true, name: true, lastSyncedAt: true }
      });
      
      // Count live agents
      const liveAgents = await openClawCliAdapter.listAgents();
      
      return {
        databaseAgents: dbAgents.length,
        liveAgents: liveAgents.length,
        inSync: dbAgents.length === liveAgents.length,
        dbAgentNames: dbAgents.map(a => a.name),
        liveAgentNames: liveAgents.map(a => a.name),
        lastSync: dbAgents.length > 0 ? Math.max(...dbAgents.map(a => a.lastSyncedAt?.getTime() || 0)) : null
      };
      
    } catch (error) {
      console.error("❌ Sync status check failed:", error);
      return {
        databaseAgents: 0,
        liveAgents: 0,
        inSync: false,
        dbAgentNames: [],
        liveAgentNames: [],
        lastSync: null,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  })
});
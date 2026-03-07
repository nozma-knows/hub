import { createTrpcRouter, protectedProcedure } from "../init";

export const syncRouter = createTrpcRouter({
  manualSync: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      // Only import what we need to avoid circuit breaker issues
      const { openClawCliAdapter } = await import("@/lib/openclaw/cli-adapter");
      const { db } = await import("@/lib/db");
      const { agents } = await import("@/db/schema");
      
      console.log("🔄 Starting isolated manual sync...");
      
      // Get live agents from CLI only
      const liveAgents = await openClawCliAdapter.listAgents();
      console.log(`📡 Found ${liveAgents.length} live agents:`, liveAgents.map(a => `${a.name}(${a.id})`));
      
      const workspaceId = ctx.workspace.id;
      console.log(`🏢 Using workspace: ${workspaceId}`);

      let syncedCount = 0;
      
      // Insert each live agent
      for (const agent of liveAgents) {
        try {
          await db
            .insert(agents)
            .values({
              id: agent.id,
              workspaceId,
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
        message: `Successfully synced ${syncedCount} agents to workspace ${workspaceId}`, 
        agentCount: syncedCount,
        agentNames: liveAgents.map(a => a.name)
      };
      
    } catch (error) {
      console.error("❌ Manual sync failed:", error);
      throw new Error(`Manual sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }),

  checkSyncStatus: protectedProcedure.query(async ({ ctx }) => {
    try {
      const { db } = await import("@/lib/db");
      const { openClawCliAdapter } = await import("@/lib/openclaw/cli-adapter");
      
      // Count agents in database for this workspace
      const dbAgents = await db.query.agents.findMany({
        where: (agents, { and, eq }) => and(eq(agents.workspaceId, ctx.workspace.id), eq(agents.isRemoved, false)),
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
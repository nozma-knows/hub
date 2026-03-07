// Manual sync trigger for development
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { agents } from "@/db/schema";
import { db } from "@/lib/db";
import { openClawCliAdapter } from "@/lib/openclaw/cli-adapter";

export async function triggerManualSync(): Promise<{ success: boolean; message: string; agents: number }> {
  try {
    console.log("🔄 Starting manual OpenClaw sync...");
    
    // Get live agents from OpenClaw CLI
    const live = await openClawCliAdapter.listAgents();
    console.log(`📡 Found ${live.length} live agents:`, live.map(a => a.name));
    
    // Get all workspaces
    const workspaceRows = await db.query.workspaces.findMany({
      columns: { id: true }
    });
    
    if (workspaceRows.length === 0) {
      return { success: false, message: "No workspaces found", agents: 0 };
    }
    
    let totalSynced = 0;
    
    // Sync agents to all workspaces
    for (const workspace of workspaceRows) {
      console.log(`🏢 Syncing to workspace: ${workspace.id}`);
      
      // Insert/update live agents
      for (const agent of live) {
        await db
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
          });
        
        totalSynced++;
        console.log(`✅ Synced agent: ${agent.name} (${agent.id})`);
      }
      
      // Mark removed agents
      const existing = await db.query.agents.findMany({
        where: and(eq(agents.workspaceId, workspace.id), eq(agents.isRemoved, false)),
        columns: { id: true }
      });
      
      const existingIds = existing.map((row) => row.id);
      const liveIds = live.map((agent) => agent.id);
      
      if (existingIds.length > 0 && liveIds.length > 0) {
        const removedIds = existingIds.filter(id => !liveIds.includes(id));
        
        if (removedIds.length > 0) {
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
                inArray(agents.id, removedIds)
              )
            );
          
          console.log(`🗑️ Marked ${removedIds.length} agents as removed`);
        }
      }
    }
    
    console.log(`🎉 Sync complete! Synced ${totalSynced} agent records`);
    return { 
      success: true, 
      message: `Successfully synced ${live.length} agents`, 
      agents: live.length 
    };
    
  } catch (error) {
    console.error("❌ Sync failed:", error);
    return { 
      success: false, 
      message: error instanceof Error ? error.message : 'Unknown sync error', 
      agents: 0 
    };
  }
}

if (require.main === module) {
  // Run if called directly
  triggerManualSync().then(result => {
    console.log("Sync result:", result);
    process.exit(result.success ? 0 : 1);
  });
}
import { z } from "zod";

import { publicProcedure, createTrpcRouter } from "../init";
import { openClawMonitor } from "@/lib/openclaw/monitoring";

export const monitoringRouter = createTrpcRouter({
  getCurrentSnapshot: publicProcedure.query(async () => {
    return openClawMonitor.getCurrentSnapshot();
  }),

  getAgentSessions: publicProcedure
    .input(z.object({
      agentId: z.string().optional()
    }))
    .query(async ({ input }) => {
      const snapshot = await openClawMonitor.getCurrentSnapshot();
      
      if (input.agentId) {
        return snapshot.sessions.filter(session => session.agentId === input.agentId);
      }
      
      return snapshot.sessions;
    }),

  getCronJobs: publicProcedure
    .input(z.object({
      agentId: z.string().optional(),
      enabled: z.boolean().optional()
    }))
    .query(async ({ input }) => {
      const snapshot = await openClawMonitor.getCurrentSnapshot();
      let jobs = snapshot.cronJobs;
      
      if (input.agentId) {
        jobs = jobs.filter(job => job.agentId === input.agentId);
      }
      
      if (input.enabled !== undefined) {
        jobs = jobs.filter(job => job.enabled === input.enabled);
      }
      
      return jobs;
    }),

  getPerformanceMetrics: publicProcedure
    .input(z.object({
      timeRange: z.enum(['1h', '6h', '24h', '7d']).optional().default('1h')
    }))
    .query(async ({ input }) => {
      const snapshot = await openClawMonitor.getCurrentSnapshot();
      
      // For now, return current metrics
      // TODO: Implement historical data based on timeRange
      return {
        current: snapshot.performance,
        history: [], // Will be populated with historical data
        timeRange: input.timeRange
      };
    }),

  getGatewayStatus: publicProcedure.query(async () => {
    const snapshot = await openClawMonitor.getCurrentSnapshot();
    return snapshot.gatewayStatus;
  }),

  getSystemHealth: publicProcedure.query(async () => {
    const snapshot = await openClawMonitor.getCurrentSnapshot();
    
    // Calculate overall system health
    const agentsOnline = snapshot.agents.filter(agent => 
      agent.status === 'ready' || agent.status === 'active'
    ).length;
    
    const activeSessions = snapshot.sessions.filter(session => 
      session.status === 'active'
    ).length;
    
    const enabledCronJobs = snapshot.cronJobs.filter(job => job.enabled).length;
    const failedCronJobs = snapshot.cronJobs.filter(job => 
      job.lastStatus === 'failure' || job.lastStatus === 'timeout'
    ).length;
    
    const overallHealth = snapshot.gatewayStatus.online && 
      snapshot.performance.failureRate < 0.1 ? 'healthy' : 'unhealthy';
    
    return {
      overallHealth,
      gateway: {
        online: snapshot.gatewayStatus.online,
        responseTime: snapshot.gatewayStatus.responseTime
      },
      agents: {
        total: snapshot.agents.length,
        online: agentsOnline
      },
      sessions: {
        active: activeSessions,
        total: snapshot.sessions.length
      },
      cronJobs: {
        enabled: enabledCronJobs,
        failed: failedCronJobs,
        total: snapshot.cronJobs.length
      },
      performance: {
        failureRate: snapshot.performance.failureRate,
        averageResponseTime: snapshot.performance.averageResponseTime,
        memoryUsage: snapshot.performance.memoryUsage
      },
      timestamp: snapshot.timestamp
    };
  }),

  startRealTimeMonitoring: publicProcedure
    .input(z.object({
      intervalMs: z.number().min(5000).max(300000).optional().default(30000)
    }))
    .mutation(async ({ input }) => {
      openClawMonitor.startRealTimeMonitoring(input.intervalMs);
      return { started: true, intervalMs: input.intervalMs };
    }),

  stopRealTimeMonitoring: publicProcedure.mutation(async () => {
    openClawMonitor.stopRealTimeMonitoring();
    return { stopped: true };
  }),

  triggerSync: publicProcedure.mutation(async () => {
    try {
      // Import and run sync logic
      const { and, eq, inArray } = await import("drizzle-orm");
      const { agents } = await import("@/db/schema");
      const { db } = await import("@/lib/db");
      const { openClawCliAdapter } = await import("@/lib/openclaw/cli-adapter");
      
      console.log("🔄 Starting manual OpenClaw sync...");
      
      // Get live agents from OpenClaw CLI
      const live = await openClawCliAdapter.listAgents();
      console.log(`📡 Found ${live.length} live agents:`, live.map((a: any) => a.name));
      
      // Get all workspaces
      const workspaceRows = await db.query.workspaces.findMany({
        columns: { id: true }
      });
      
      if (workspaceRows.length === 0) {
        throw new Error("No workspaces found");
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
      }
      
      console.log(`🎉 Sync complete! Synced ${totalSynced} agent records`);
      return { 
        success: true, 
        message: `Successfully synced ${live.length} agents`, 
        agents: live.length 
      };
      
    } catch (error) {
      console.error("❌ Sync failed:", error);
      throw new Error(`Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }),

  getSystemInfo: publicProcedure.query(async () => {
    const { openClawCliAdapter } = await import("@/lib/openclaw/cli-adapter");
    return openClawCliAdapter.getSystemInfo();
  })
});
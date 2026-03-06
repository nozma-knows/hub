import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { agentBehaviorConfigs, agents, agentToolPermissions, toolProviders } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { openClawAdapter } from "@/lib/openclaw/adapter";
import { createTrpcRouter, protectedProcedure } from "@/server/trpc/init";

const behaviorSchema = z.object({
  model: z.string().min(1),
  instructions: z.string().min(1),
  runtimeConfig: z.record(z.string(), z.any()).optional()
});

export const agentsRouter = createTrpcRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.query.agents.findMany({
      orderBy: (table, { asc }) => [asc(table.name)]
    });

    if (rows.length > 0) {
      return rows;
    }

    try {
      const liveAgents = await openClawAdapter.listAgents();
      if (liveAgents.length > 0) {
        await Promise.all(
          liveAgents.map((agent) =>
            ctx.db
              .insert(agents)
              .values({
                id: agent.id,
                name: agent.name,
                status: agent.status,
                openclawVersion: agent.version,
                behaviorChecksum: agent.behaviorChecksum,
                lastSyncedAt: new Date()
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
      }

      return ctx.db.query.agents.findMany({
        orderBy: (table, { asc }) => [asc(table.name)]
      });
    } catch {
      return rows;
    }
  }),

  sync: protectedProcedure.mutation(async ({ ctx }) => {
    const liveAgents = await openClawAdapter.listAgents();

    await Promise.all(
      liveAgents.map((agent) =>
        ctx.db
          .insert(agents)
          .values({
            id: agent.id,
            name: agent.name,
            status: agent.status,
            openclawVersion: agent.version,
            behaviorChecksum: agent.behaviorChecksum,
            lastSyncedAt: new Date()
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

    await logAuditEvent({
      eventType: "agents.sync",
      actorUserId: ctx.user.id,
      result: "success",
      details: {
        count: liveAgents.length
      }
    });

    return {
      count: liveAgents.length
    };
  }),

  get: protectedProcedure
    .input(
      z.object({
        agentId: z.string().min(1)
      })
    )
    .query(async ({ ctx, input }) => {
      const agent = await ctx.db.query.agents.findFirst({
        where: eq(agents.id, input.agentId)
      });

      const behaviors = await ctx.db.query.agentBehaviorConfigs.findMany({
        where: eq(agentBehaviorConfigs.agentId, input.agentId),
        orderBy: (table, { desc: descOrder }) => [descOrder(table.version)]
      });

      return {
        agent,
        behaviors
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        behavior: behaviorSchema
      })
    )
    .mutation(async ({ ctx, input }) => {
      const validation = await openClawAdapter.validateAgentBehavior(input.behavior);
      if (!validation.valid) {
        throw new Error(`Invalid behavior config: ${validation.issues.join(", ")}`);
      }

      const remote = await openClawAdapter.createAgent({
        name: input.name,
        behavior: input.behavior
      });

      await ctx.db.insert(agents).values({
        id: remote.id,
        name: remote.name,
        status: remote.status,
        openclawVersion: remote.version,
        behaviorChecksum: validation.checksum,
        lastSyncedAt: new Date()
      });

      await ctx.db.insert(agentBehaviorConfigs).values({
        agentId: remote.id,
        version: 1,
        model: input.behavior.model,
        instructions: input.behavior.instructions,
        runtimeConfig: input.behavior.runtimeConfig ?? {},
        isActive: true,
        updatedBy: ctx.user.id
      });

      await logAuditEvent({
        eventType: "agents.create",
        actorUserId: ctx.user.id,
        agentId: remote.id,
        result: "success"
      });

      return remote;
    }),

  update: protectedProcedure
    .input(
      z.object({
        agentId: z.string().min(1),
        name: z.string().min(1).optional(),
        behavior: behaviorSchema.optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.behavior) {
        const validation = await openClawAdapter.validateAgentBehavior(input.behavior);
        if (!validation.valid) {
          throw new Error(`Invalid behavior config: ${validation.issues.join(", ")}`);
        }
      }

      const updatedRemote = await openClawAdapter.updateAgent(input.agentId, {
        name: input.name,
        behavior: input.behavior
      });

      await ctx.db
        .insert(agents)
        .values({
          id: updatedRemote.id,
          name: updatedRemote.name,
          status: updatedRemote.status,
          openclawVersion: updatedRemote.version,
          behaviorChecksum: updatedRemote.behaviorChecksum,
          lastSyncedAt: new Date(),
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: agents.id,
          set: {
            name: updatedRemote.name,
            status: updatedRemote.status,
            openclawVersion: updatedRemote.version,
            behaviorChecksum: updatedRemote.behaviorChecksum,
            lastSyncedAt: new Date(),
            updatedAt: new Date()
          }
        });

      if (input.behavior) {
        const [nextVersion] = await ctx.db
          .select({
            nextVersion: sql<number>`coalesce(max(${agentBehaviorConfigs.version}), 0) + 1`
          })
          .from(agentBehaviorConfigs)
          .where(eq(agentBehaviorConfigs.agentId, input.agentId));

        await ctx.db
          .update(agentBehaviorConfigs)
          .set({
            isActive: false
          })
          .where(eq(agentBehaviorConfigs.agentId, input.agentId));

        await ctx.db.insert(agentBehaviorConfigs).values({
          agentId: input.agentId,
          version: nextVersion?.nextVersion ?? 1,
          model: input.behavior.model,
          instructions: input.behavior.instructions,
          runtimeConfig: input.behavior.runtimeConfig ?? {},
          isActive: true,
          updatedBy: ctx.user.id
        });
      }

      await logAuditEvent({
        eventType: "agents.update",
        actorUserId: ctx.user.id,
        agentId: input.agentId,
        result: "success"
      });

      return updatedRemote;
    }),

  remove: protectedProcedure
    .input(
      z.object({
        agentId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      await openClawAdapter.deleteAgent(input.agentId);

      await ctx.db.delete(agentToolPermissions).where(eq(agentToolPermissions.agentId, input.agentId));
      await ctx.db.delete(agentBehaviorConfigs).where(eq(agentBehaviorConfigs.agentId, input.agentId));
      await ctx.db.delete(agents).where(eq(agents.id, input.agentId));

      await logAuditEvent({
        eventType: "agents.delete",
        actorUserId: ctx.user.id,
        agentId: input.agentId,
        result: "success"
      });

      return {
        success: true
      };
    }),

  history: protectedProcedure
    .input(
      z.object({
        agentId: z.string().min(1)
      })
    )
    .query(async ({ ctx, input }) => {
      return ctx.db.query.agentBehaviorConfigs.findMany({
        where: eq(agentBehaviorConfigs.agentId, input.agentId),
        orderBy: (table, { desc: descOrder }) => [descOrder(table.version)]
      });
    }),

  matrixSummary: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        agentId: agents.id,
        agentName: agents.name,
        providerKey: toolProviders.key,
        allowed: agentToolPermissions.isAllowed
      })
      .from(agents)
      .leftJoin(agentToolPermissions, eq(agentToolPermissions.agentId, agents.id))
      .leftJoin(toolProviders, eq(toolProviders.id, agentToolPermissions.providerId));

    return rows;
  })
});

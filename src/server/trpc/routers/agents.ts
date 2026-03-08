import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";

import { agentBehaviorConfigs, agents, agentToolPermissions, toolProviders } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { openClawAdapter } from "@/lib/openclaw/adapter";
import { openClawCliAdapter } from "@/lib/openclaw/cli-adapter";
import { adminProcedure, createTrpcRouter, protectedProcedure } from "@/server/trpc/init";

const behaviorSchema = z.object({
  model: z.string().min(1),
  instructions: z.string().min(1),
  runtimeConfig: z.record(z.string(), z.any()).optional()
});

async function upsertWorkspaceAgents(input: {
  workspaceId: string;
  rows: Awaited<ReturnType<typeof openClawCliAdapter.listAgents>>;
  db: any;
}) {
  if (input.rows.length === 0) {
    return;
  }

  await Promise.all(
    input.rows.map((agent) =>
      input.db
        .insert(agents)
        .values({
          id: agent.id,
          workspaceId: input.workspaceId,
          name: agent.name,
          status: agent.status,
          openclawVersion: agent.version,
          model: agent.model,
          upstreamWorkspacePath: agent.workspacePath,
          upstreamAgentDir: agent.agentDir,
          behaviorChecksum: agent.behaviorChecksum,
          isRemoved: false,
          removedAt: null,
          lastSeenUpstreamAt: new Date(),
          lastSyncedAt: new Date()
        })
        .onConflictDoUpdate({
          target: agents.id,
          set: {
            workspaceId: input.workspaceId,
            name: agent.name,
            status: agent.status,
            openclawVersion: agent.version,
            model: agent.model,
            upstreamWorkspacePath: agent.workspacePath,
            upstreamAgentDir: agent.agentDir,
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
}

async function softMarkMissingAgents(input: {
  workspaceId: string;
  liveAgentIds: string[];
  db: any;
}) {
  const existing = await input.db.query.agents.findMany({
    where: and(eq(agents.workspaceId, input.workspaceId), eq(agents.isRemoved, false)),
    columns: {
      id: true
    }
  });
  const existingIds = existing.map((row: { id: string }) => row.id);
  if (existingIds.length === 0) {
    return 0;
  }

  if (input.liveAgentIds.length === 0) {
    await input.db
      .update(agents)
      .set({
        isRemoved: true,
        removedAt: new Date(),
        updatedAt: new Date()
      })
      .where(and(eq(agents.workspaceId, input.workspaceId), inArray(agents.id, existingIds)));
    return existingIds.length;
  }

  await input.db
    .update(agents)
    .set({
      isRemoved: true,
      removedAt: new Date(),
      updatedAt: new Date()
    })
    .where(
      and(
        eq(agents.workspaceId, input.workspaceId),
        inArray(agents.id, existingIds),
        notInArray(agents.id, input.liveAgentIds)
      )
    );

  return existingIds.filter((id: string) => !input.liveAgentIds.includes(id)).length;
}

export const agentsRouter = createTrpcRouter({
  filesList: adminProcedure
    .input(z.object({ agentId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const agent = await ctx.db.query.agents.findFirst({
        where: and(eq(agents.workspaceId, ctx.workspace.id), eq(agents.id, input.agentId))
      });
      if (!agent?.upstreamWorkspacePath) throw new Error("Agent workspace path not known yet. Sync first.");

      const { listAgentWorkspaceFiles } = await import("@/lib/openclaw/agent-files");
      return listAgentWorkspaceFiles({ workspacePath: agent.upstreamWorkspacePath });
    }),

  filesRead: adminProcedure
    .input(z.object({ agentId: z.string().min(1), path: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const agent = await ctx.db.query.agents.findFirst({
        where: and(eq(agents.workspaceId, ctx.workspace.id), eq(agents.id, input.agentId))
      });
      if (!agent?.upstreamWorkspacePath) throw new Error("Agent workspace path not known yet. Sync first.");

      const { readAgentWorkspaceFile } = await import("@/lib/openclaw/agent-files");
      return {
        path: input.path,
        content: await readAgentWorkspaceFile({ workspacePath: agent.upstreamWorkspacePath, relativePath: input.path })
      };
    }),

  filesWrite: adminProcedure
    .input(z.object({ agentId: z.string().min(1), path: z.string().min(1), content: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.db.query.agents.findFirst({
        where: and(eq(agents.workspaceId, ctx.workspace.id), eq(agents.id, input.agentId))
      });
      if (!agent?.upstreamWorkspacePath) throw new Error("Agent workspace path not known yet. Sync first.");

      const { writeAgentWorkspaceFile } = await import("@/lib/openclaw/agent-files");
      await writeAgentWorkspaceFile({
        workspacePath: agent.upstreamWorkspacePath,
        relativePath: input.path,
        content: input.content
      });

      await logAuditEvent({
        workspaceId: ctx.workspace.id,
        eventType: "agents.files.write",
        actorUserId: ctx.user!.id,
        agentId: input.agentId,
        result: "success",
        details: {
          path: input.path,
          bytes: input.content.length
        }
      });

      return { ok: true };
    }),

  listValidModels: adminProcedure.query(async () => {
    // Source of truth: OpenClaw config `agents.defaults.models` keys
    const { openClawConfigGet } = await import("@/lib/openclaw/cli-adapter");
    const models = (await openClawConfigGet("agents.defaults.models")) as Record<string, unknown>;
    const keys = models && typeof models === "object" ? Object.keys(models) : [];
    keys.sort();
    return keys;
  }),

  setModel: adminProcedure
    .input(z.object({ agentId: z.string().min(1), model: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { openClawSetAgentModel } = await import("@/lib/openclaw/cli-adapter");
      await openClawSetAgentModel({ agentId: input.agentId, model: input.model });

      await ctx.db
        .update(agents)
        .set({ model: input.model, updatedAt: new Date() })
        .where(and(eq(agents.workspaceId, ctx.workspace.id), eq(agents.id, input.agentId)));

      await logAuditEvent({
        workspaceId: ctx.workspace.id,
        eventType: "agents.model.set",
        actorUserId: ctx.user!.id,
        agentId: input.agentId,
        result: "success",
        details: { model: input.model }
      });

      return { ok: true };
    }),

  createIsolated: adminProcedure
    .input(
      z.object({
        agentId: z.string().min(1),
        model: z.string().min(1),
        files: z.array(z.object({ path: z.string().min(1), content: z.string() })).default([])
      })
    )
    .mutation(async ({ ctx, input }) => {
      const workspacePath = `~/.openclaw/agents/${input.agentId}/workspace`;

      const { openClawAddAgent, openClawSetIdentityFromWorkspace } = await import("@/lib/openclaw/cli-adapter");
      const result = await openClawAddAgent({
        agentId: input.agentId,
        workspacePath,
        model: input.model
      });

      // Seed files into the agent workspace
      const { expandHome, resolveSafeRoot, resolveSafeFile } = await import("@/lib/openclaw/fs-allowlist");
      const fs = await import("node:fs/promises");
      const nodePath = await import("node:path");
      const root = await resolveSafeRoot(expandHome(workspacePath));
      for (const f of input.files) {
        const abs = await resolveSafeFile(root, f.path);
        await fs.mkdir(nodePath.dirname(abs), { recursive: true });
        await fs.writeFile(abs, f.content, "utf8");
      }

      // If IDENTITY.md was provided, apply it via OpenClaw CLI
      if (input.files.some((f) => f.path === "IDENTITY.md")) {
        try {
          await openClawSetIdentityFromWorkspace({ agentId: input.agentId, workspacePath });
        } catch {
          // non-fatal; identity can be applied later
        }
      }

      // Pull latest agent list into DB
      const liveAgents = await openClawCliAdapter.listAgents();
      await upsertWorkspaceAgents({ workspaceId: ctx.workspace.id, rows: liveAgents, db: ctx.db });

      await logAuditEvent({
        workspaceId: ctx.workspace.id,
        eventType: "agents.create.isolated",
        actorUserId: ctx.user!.id,
        agentId: input.agentId,
        result: "success",
        details: { model: input.model }
      });

      return { result };
    }),
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.query.agents.findMany({
      where: eq(agents.workspaceId, ctx.workspace.id),
      orderBy: (table, { asc }) => [asc(table.name)]
    });

    if (rows.length > 0) {
      return rows;
    }

    try {
      const liveAgents = await openClawCliAdapter.listAgents();
      await upsertWorkspaceAgents({
        workspaceId: ctx.workspace.id,
        rows: liveAgents,
        db: ctx.db
      });

      await softMarkMissingAgents({
        workspaceId: ctx.workspace.id,
        liveAgentIds: liveAgents.map((agent) => agent.id),
        db: ctx.db
      });
    } catch {
      return rows;
    }

    return ctx.db.query.agents.findMany({
      where: eq(agents.workspaceId, ctx.workspace.id),
      orderBy: (table, { asc }) => [asc(table.name)]
    });
  }),

  sync: protectedProcedure.mutation(async ({ ctx }) => {
    const liveAgents = await openClawCliAdapter.listAgents();

    await upsertWorkspaceAgents({
      workspaceId: ctx.workspace.id,
      rows: liveAgents,
      db: ctx.db
    });

    const removedCount = await softMarkMissingAgents({
      workspaceId: ctx.workspace.id,
      liveAgentIds: liveAgents.map((agent) => agent.id),
      db: ctx.db
    });

    await logAuditEvent({
      workspaceId: ctx.workspace.id,
      eventType: "agents.sync",
      actorUserId: ctx.user!.id,
      result: "success",
      details: {
        count: liveAgents.length,
        removedCount
      }
    });

    return {
      count: liveAgents.length,
      removedCount
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
        where: and(eq(agents.workspaceId, ctx.workspace.id), eq(agents.id, input.agentId))
      });

      const behaviors = await ctx.db.query.agentBehaviorConfigs.findMany({
        where: and(
          eq(agentBehaviorConfigs.workspaceId, ctx.workspace.id),
          eq(agentBehaviorConfigs.agentId, input.agentId)
        ),
        orderBy: (table, { desc: descOrder }) => [descOrder(table.version)]
      });

      return {
        agent,
        behaviors
      };
    }),

  getConfig: protectedProcedure
    .input(
      z.object({
        agentId: z.string().min(1)
      })
    )
    .query(async ({ input }) => {
      return openClawAdapter.getAgentConfig(input.agentId);
    }),

  updateConfig: adminProcedure
    .input(
      z.object({
        agentId: z.string().min(1),
        files: z.array(
          z.object({
            path: z.string().min(1),
            content: z.string()
          })
        )
      })
    )
    .mutation(async ({ ctx, input }) => {
      const updated = await openClawAdapter.updateAgentConfig({
        agentId: input.agentId,
        files: input.files
      });

      await logAuditEvent({
        workspaceId: ctx.workspace.id,
        eventType: "agents.config.update",
        actorUserId: ctx.user!.id,
        agentId: input.agentId,
        result: "success",
        details: {
          fileCount: input.files.length
        }
      });

      return updated;
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
        workspaceId: ctx.workspace.id,
        name: remote.name,
        status: remote.status,
        openclawVersion: remote.version,
        behaviorChecksum: validation.checksum,
        isRemoved: false,
        removedAt: null,
        lastSeenUpstreamAt: new Date(),
        lastSyncedAt: new Date()
      });

      await ctx.db.insert(agentBehaviorConfigs).values({
        workspaceId: ctx.workspace.id,
        agentId: remote.id,
        version: 1,
        model: input.behavior.model,
        instructions: input.behavior.instructions,
        runtimeConfig: input.behavior.runtimeConfig ?? {},
        isActive: true,
        updatedBy: ctx.user!.id
      });

      await logAuditEvent({
        workspaceId: ctx.workspace.id,
        eventType: "agents.create",
        actorUserId: ctx.user!.id,
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
          workspaceId: ctx.workspace.id,
          name: updatedRemote.name,
          status: updatedRemote.status,
          openclawVersion: updatedRemote.version,
          behaviorChecksum: updatedRemote.behaviorChecksum,
          isRemoved: false,
          removedAt: null,
          lastSeenUpstreamAt: new Date(),
          lastSyncedAt: new Date(),
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: agents.id,
          set: {
            workspaceId: ctx.workspace.id,
            name: updatedRemote.name,
            status: updatedRemote.status,
            openclawVersion: updatedRemote.version,
            behaviorChecksum: updatedRemote.behaviorChecksum,
            isRemoved: false,
            removedAt: null,
            lastSeenUpstreamAt: new Date(),
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
          .where(
            and(
              eq(agentBehaviorConfigs.workspaceId, ctx.workspace.id),
              eq(agentBehaviorConfigs.agentId, input.agentId)
            )
          );

        await ctx.db
          .update(agentBehaviorConfigs)
          .set({
            isActive: false
          })
          .where(
            and(
              eq(agentBehaviorConfigs.workspaceId, ctx.workspace.id),
              eq(agentBehaviorConfigs.agentId, input.agentId)
            )
          );

        await ctx.db.insert(agentBehaviorConfigs).values({
          workspaceId: ctx.workspace.id,
          agentId: input.agentId,
          version: nextVersion?.nextVersion ?? 1,
          model: input.behavior.model,
          instructions: input.behavior.instructions,
          runtimeConfig: input.behavior.runtimeConfig ?? {},
          isActive: true,
          updatedBy: ctx.user!.id
        });
      }

      await logAuditEvent({
        workspaceId: ctx.workspace.id,
        eventType: "agents.update",
        actorUserId: ctx.user!.id,
        agentId: input.agentId,
        result: "success"
      });

      return updatedRemote;
    }),

  remove: adminProcedure
    .input(
      z.object({
        agentId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      await openClawAdapter.deleteAgent(input.agentId);

      await ctx.db
        .delete(agentToolPermissions)
        .where(
          and(
            eq(agentToolPermissions.workspaceId, ctx.workspace.id),
            eq(agentToolPermissions.agentId, input.agentId)
          )
        );
      await ctx.db
        .delete(agentBehaviorConfigs)
        .where(
          and(
            eq(agentBehaviorConfigs.workspaceId, ctx.workspace.id),
            eq(agentBehaviorConfigs.agentId, input.agentId)
          )
        );
      await ctx.db
        .delete(agents)
        .where(and(eq(agents.workspaceId, ctx.workspace.id), eq(agents.id, input.agentId)));

      await logAuditEvent({
        workspaceId: ctx.workspace.id,
        eventType: "agents.delete",
        actorUserId: ctx.user!.id,
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
        where: and(
          eq(agentBehaviorConfigs.workspaceId, ctx.workspace.id),
          eq(agentBehaviorConfigs.agentId, input.agentId)
        ),
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
      .leftJoin(
        agentToolPermissions,
        and(
          eq(agentToolPermissions.workspaceId, ctx.workspace.id),
          eq(agentToolPermissions.agentId, agents.id)
        )
      )
      .leftJoin(toolProviders, eq(toolProviders.id, agentToolPermissions.providerId))
      .where(eq(agents.workspaceId, ctx.workspace.id));

    return rows;
  })
});

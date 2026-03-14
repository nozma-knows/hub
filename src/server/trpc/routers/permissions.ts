import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { agentToolPermissions, agents, toolProviders } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { adminProcedure, createTrpcRouter, protectedProcedure } from "@/server/trpc/init";

export const permissionsRouter = createTrpcRouter({
  matrix: protectedProcedure.query(async ({ ctx }) => {
    const [agentRows, providerRows, permissionRows] = await Promise.all([
      ctx.db.query.agents.findMany({
        where: eq(agents.workspaceId, ctx.workspace.id),
        orderBy: (table, { asc }) => [asc(table.name)],
      }),
      ctx.db.query.toolProviders.findMany({
        orderBy: (table, { asc }) => [asc(table.name)],
      }),
      ctx.db.query.agentToolPermissions.findMany({
        where: eq(agentToolPermissions.workspaceId, ctx.workspace.id),
      }),
    ]);

    const permissions = permissionRows.map((row) => ({
      agentId: row.agentId,
      providerId: row.providerId,
      isAllowed: row.isAllowed,
      scopeOverrides: row.scopeOverrides,
    }));

    return {
      agents: agentRows,
      providers: providerRows,
      permissions,
    };
  }),

  upsert: adminProcedure
    .input(
      z.object({
        agentId: z.string().min(1),
        providerId: z.string().uuid(),
        isAllowed: z.boolean(),
        scopeOverrides: z
          .object({
            capabilities: z.array(z.string()).optional(),
            constraints: z.record(z.string(), z.any()).optional(),
          })
          .default({}),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(agentToolPermissions)
        .values({
          workspaceId: ctx.workspace.id,
          agentId: input.agentId,
          providerId: input.providerId,
          isAllowed: input.isAllowed,
          scopeOverrides: input.scopeOverrides,
          updatedBy: ctx.user!.id,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            agentToolPermissions.workspaceId,
            agentToolPermissions.agentId,
            agentToolPermissions.providerId,
          ],
          set: {
            isAllowed: input.isAllowed,
            scopeOverrides: input.scopeOverrides,
            updatedBy: ctx.user!.id,
            updatedAt: new Date(),
          },
        });

      const provider = await ctx.db.query.toolProviders.findFirst({
        where: eq(toolProviders.id, input.providerId),
      });

      await logAuditEvent({
        workspaceId: ctx.workspace.id,
        eventType: "permissions.update",
        actorUserId: ctx.user!.id,
        agentId: input.agentId,
        providerKey: provider?.key,
        result: "success",
        details: {
          isAllowed: input.isAllowed,
          scopeOverrides: input.scopeOverrides,
        },
      });

      return { success: true };
    }),
});

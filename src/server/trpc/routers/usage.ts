import { and, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";

import { agentInvocations } from "@/db/schema";
import { createTrpcRouter, protectedProcedure } from "@/server/trpc/init";

export const usageRouter = createTrpcRouter({
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).default(50),
          agentId: z.string().optional(),
          from: z.string().datetime().optional(),
          to: z.string().datetime().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(agentInvocations.workspaceId, ctx.workspace.id)];
      if (input?.agentId) {
        conditions.push(eq(agentInvocations.agentId, input.agentId));
      }
      if (input?.from) {
        conditions.push(gte(agentInvocations.createdAt, new Date(input.from)));
      }
      if (input?.to) {
        conditions.push(lte(agentInvocations.createdAt, new Date(input.to)));
      }

      return ctx.db.query.agentInvocations.findMany({
        where: and(...conditions),
        orderBy: [desc(agentInvocations.createdAt)],
        limit: input?.limit ?? 50,
      });
    }),
});

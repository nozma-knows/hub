import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { auditEvents } from "@/db/schema";
import { createTrpcRouter, protectedProcedure } from "@/server/trpc/init";

export const auditRouter = createTrpcRouter({
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).default(50),
          agentId: z.string().optional(),
          providerKey: z.string().optional()
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 50;
      const conditions = [];

      if (input?.agentId) {
        conditions.push(eq(auditEvents.agentId, input.agentId));
      }

      if (input?.providerKey) {
        conditions.push(eq(auditEvents.providerKey, input.providerKey));
      }

      return ctx.db.query.auditEvents.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: (table, { desc: descOrder }) => [descOrder(table.createdAt)],
        limit
      });
    })
});

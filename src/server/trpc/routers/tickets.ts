import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { hubTickets } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { adminProcedure, createTrpcRouter, protectedProcedure } from "@/server/trpc/init";

const statusSchema = z.enum(["todo", "doing", "done"]);
const prioritySchema = z.enum(["low", "normal", "high", "urgent"]);

export const ticketsRouter = createTrpcRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.hubTickets.findMany({
      where: eq(hubTickets.workspaceId, ctx.workspace.id),
      orderBy: (t, { desc: descOrder }) => [descOrder(t.updatedAt)]
    });
  }),

  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(200),
        description: z.string().optional(),
        priority: prioritySchema.default("normal"),
        ownerAgentId: z.string().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = await ctx.db
        .insert(hubTickets)
        .values({
          workspaceId: ctx.workspace.id,
          title: input.title,
          description: input.description,
          priority: input.priority,
          status: "todo",
          ownerAgentId: input.ownerAgentId,
          createdByUserId: ctx.user!.id
        })
        .returning();

      if (!created) throw new Error("Failed to create ticket");

      await logAuditEvent({
        workspaceId: ctx.workspace.id,
        eventType: "tickets.create",
        actorUserId: ctx.user!.id,
        result: "success",
        details: { ticketId: created.id }
      });

      return created;
    }),

  update: adminProcedure
    .input(
      z.object({
        ticketId: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        description: z.string().optional(),
        priority: prioritySchema.optional(),
        ownerAgentId: z.string().nullable().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(hubTickets)
        .set({
          ...(input.title ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.priority ? { priority: input.priority } : {}),
          ...(input.ownerAgentId !== undefined ? { ownerAgentId: input.ownerAgentId } : {}),
          updatedAt: new Date()
        })
        .where(and(eq(hubTickets.workspaceId, ctx.workspace.id), eq(hubTickets.id, input.ticketId)));

      return { ok: true };
    }),

  move: adminProcedure
    .input(z.object({ ticketId: z.string().uuid(), status: statusSchema }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(hubTickets)
        .set({ status: input.status, updatedAt: new Date() })
        .where(and(eq(hubTickets.workspaceId, ctx.workspace.id), eq(hubTickets.id, input.ticketId)));
      return { ok: true };
    }),

  remove: adminProcedure
    .input(z.object({ ticketId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(hubTickets)
        .where(and(eq(hubTickets.workspaceId, ctx.workspace.id), eq(hubTickets.id, input.ticketId)));

      await logAuditEvent({
        workspaceId: ctx.workspace.id,
        eventType: "tickets.delete",
        actorUserId: ctx.user!.id,
        result: "success",
        details: { ticketId: input.ticketId }
      });

      return { ok: true };
    })
});

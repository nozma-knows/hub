import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { hubThreadTickets, hubTicketComments, hubTickets } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { openClawAgentTurn } from "@/lib/openclaw/cli-adapter";
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

  get: protectedProcedure
    .input(z.object({ ticketId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const ticket = await ctx.db.query.hubTickets.findFirst({
        where: and(eq(hubTickets.workspaceId, ctx.workspace.id), eq(hubTickets.id, input.ticketId))
      });
      if (!ticket) throw new Error("Ticket not found");

      const comments = await ctx.db.query.hubTicketComments.findMany({
        where: and(eq(hubTicketComments.workspaceId, ctx.workspace.id), eq(hubTicketComments.ticketId, input.ticketId)),
        orderBy: (t, { asc }) => [asc(t.createdAt)]
      });

      const links = await ctx.db.query.hubThreadTickets.findMany({
        where: and(eq(hubThreadTickets.workspaceId, ctx.workspace.id), eq(hubThreadTickets.ticketId, input.ticketId))
      });

      return { ticket, comments, threadLinks: links };
    }),

  commentAdd: protectedProcedure
    .input(z.object({ ticketId: z.string().uuid(), body: z.string().min(1).max(20_000) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.insert(hubTicketComments).values({
        workspaceId: ctx.workspace.id,
        ticketId: input.ticketId,
        authorType: "human",
        authorUserId: ctx.user!.id,
        body: input.body
      });

      await ctx.db
        .update(hubTickets)
        .set({ updatedAt: new Date() })
        .where(and(eq(hubTickets.workspaceId, ctx.workspace.id), eq(hubTickets.id, input.ticketId)));

      return { ok: true };
    }),

  createFromThread: protectedProcedure
    .input(
      z.object({
        threadId: z.string().uuid(),
        title: z.string().min(1).max(200),
        description: z.string().optional(),
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
          status: "todo",
          priority: "normal",
          ownerAgentId: input.ownerAgentId,
          createdByUserId: ctx.user!.id
        })
        .returning();

      if (!created) throw new Error("Failed to create ticket");

      await ctx.db.insert(hubThreadTickets).values({
        workspaceId: ctx.workspace.id,
        threadId: input.threadId,
        ticketId: created.id
      });

      await logAuditEvent({
        workspaceId: ctx.workspace.id,
        eventType: "tickets.createFromThread",
        actorUserId: ctx.user!.id,
        result: "success",
        details: { ticketId: created.id, threadId: input.threadId }
      });

      return created;
    }),

  invokeOwner: adminProcedure
    .input(z.object({ ticketId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const ticket = await ctx.db.query.hubTickets.findFirst({
        where: and(eq(hubTickets.workspaceId, ctx.workspace.id), eq(hubTickets.id, input.ticketId))
      });
      if (!ticket) throw new Error("Ticket not found");
      if (!ticket.ownerAgentId) throw new Error("Ticket has no owner agent");

      const prompt = `You are working a ticket in OpenClaw Hub.\n\nTitle: ${ticket.title}\n\nDescription:\n${ticket.description || "(none)"}\n\nRespond with:\n- what you did\n- what changed\n- next steps (if any)\n- blockers/questions for Noah (if any)`;

      const result = await openClawAgentTurn({
        agentId: ticket.ownerAgentId,
        message: prompt,
        timeoutSeconds: 300
      });

      const output = (result.output || result.message || result.text || "").toString();

      // Save a ticket comment with the output
      await ctx.db.insert(hubTicketComments).values({
        workspaceId: ctx.workspace.id,
        ticketId: ticket.id,
        authorType: "agent",
        authorAgentId: ticket.ownerAgentId,
        body: output
      });

      await ctx.db
        .update(hubTickets)
        .set({ updatedAt: new Date() })
        .where(and(eq(hubTickets.workspaceId, ctx.workspace.id), eq(hubTickets.id, ticket.id)));

      // TODO: link to agentInvocations once we unify invocation flow (Hub-native dispatcher).

      return { ok: true, output };
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

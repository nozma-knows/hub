import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { hubDispatcherState, hubThreadTickets, hubTicketComments, hubTickets } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { openClawAgentTurn } from "@/lib/openclaw/cli-adapter";
import { adminProcedure, createTrpcRouter, protectedProcedure } from "@/server/trpc/init";

const statusSchema = z.enum(["backlog", "todo", "in_progress", "done", "canceled"]);
const prioritySchema = z.enum(["low", "normal", "high", "urgent"]);

export const ticketsRouter = createTrpcRouter({
  health: protectedProcedure.query(async ({ ctx }) => {
    const dispatcher = await ctx.db.query.hubDispatcherState.findFirst({
      where: eq(hubDispatcherState.key, "main")
    });

    const rows = await ctx.db.execute(sql`
      select status, count(*)::int as count
      from hub_tickets
      where workspace_id = ${ctx.workspace.id}
      group by status
    `);

    const byStatus: Record<string, number> = {};
    for (const r of (rows.rows as any[])) byStatus[String(r.status)] = Number(r.count);

    const running = await ctx.db.execute(sql`
      select count(*)::int as count
      from hub_tickets
      where workspace_id = ${ctx.workspace.id}
        and dispatch_state = 'running'
    `);

    const errored = await ctx.db.execute(sql`
      select count(*)::int as count
      from hub_tickets
      where workspace_id = ${ctx.workspace.id}
        and dispatch_state = 'error'
    `);

    return {
      dispatcher: dispatcher
        ? { lastTickAt: dispatcher.lastTickAt, lastError: dispatcher.lastError, updatedAt: dispatcher.updatedAt }
        : null,
      tickets: {
        byStatus,
        running: Number((running.rows as any[])[0]?.count ?? 0),
        error: Number((errored.rows as any[])[0]?.count ?? 0)
      }
    };
  }),

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

      const ticket = await ctx.db.query.hubTickets.findFirst({
        where: and(eq(hubTickets.workspaceId, ctx.workspace.id), eq(hubTickets.id, input.ticketId))
      });

      await ctx.db
        .update(hubTickets)
        .set({ updatedAt: new Date() })
        .where(and(eq(hubTickets.workspaceId, ctx.workspace.id), eq(hubTickets.id, input.ticketId)));

      // If the ticket was waiting on human input, auto-resume once a comment is added.
      // Best-effort: run async so posting input doesn't block the UI.
      if (ticket?.dispatchState === "needs_input" && ticket.ownerAgentId) {
        const runId = Math.random().toString(16).slice(2, 8);

        (async () => {
          try {
            await ctx.db.insert(hubTicketComments).values({
              workspaceId: ctx.workspace.id,
              ticketId: input.ticketId,
              authorType: "system",
              body: `▶️ Resuming (from your comment)… (${runId})`
            });

            const comments = await ctx.db.query.hubTicketComments.findMany({
              where: and(
                eq(hubTicketComments.workspaceId, ctx.workspace.id),
                eq(hubTicketComments.ticketId, input.ticketId)
              ),
              orderBy: (t, { desc }) => [desc(t.createdAt)],
              limit: 12
            });

            const context = comments
              .slice()
              .reverse()
              .map((c) => `${c.authorType === "agent" ? `agent:${c.authorAgentId ?? "?"}` : c.authorType}: ${c.body}`)
              .join("\n");

            const prompt = `You are working a ticket in OpenClaw Hub.

Title: ${ticket.title}

Description:
${ticket.description || "(none)"}

Recent ticket comments (chronological):
${context || "(none)"}

Instructions:
- Use best judgment and proceed with the recommended path.
- Only ask Noah a question if you are truly blocked.
- If you are blocked and need input, include a line starting with: NEEDS_INPUT: <your question>
- Otherwise, do not ask questions.

Respond with:
- what you did
- what changed
- next steps (if any)
- blockers/questions (if any)
`;

            const { openClawAgentTurn } = await import("@/lib/openclaw/cli-adapter");
            const result = await openClawAgentTurn({
              agentId: ticket.ownerAgentId!,
              message: prompt,
              timeoutSeconds: 600
            });

            const output = (result.output || result.message || result.text || "").toString();

            await ctx.db.insert(hubTicketComments).values({
              workspaceId: ctx.workspace.id,
              ticketId: input.ticketId,
              authorType: "agent",
              authorAgentId: ticket.ownerAgentId!,
              body: output
            });

            const needsInput = /(^|\n)\s*NEEDS_INPUT\s*:/i.test(output);

            await ctx.db
              .update(hubTickets)
              .set({
                status: needsInput ? "todo" : "in_progress",
                dispatchState: needsInput ? "needs_input" : "idle",
                lastDispatchedAt: new Date(),
                updatedAt: new Date()
              })
              .where(and(eq(hubTickets.workspaceId, ctx.workspace.id), eq(hubTickets.id, input.ticketId)));

            if (needsInput) {
              await ctx.db.insert(hubTicketComments).values({
                workspaceId: ctx.workspace.id,
                ticketId: input.ticketId,
                authorType: "system",
                body: `❓ Waiting on input from Noah. Reply with a ticket comment and I'll auto-resume.`
              });
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            try {
              await ctx.db.insert(hubTicketComments).values({
                workspaceId: ctx.workspace.id,
                ticketId: input.ticketId,
                authorType: "system",
                body: `⚠️ Auto-resume failed (${runId}): ${msg}`
              });
            } catch {
              // ignore
            }
          }
        })();
      }

      return { ok: true, autoResumed: Boolean(ticket?.dispatchState === "needs_input" && ticket?.ownerAgentId) };
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
      // Default owner is the coordinator agent.
      const rawOwnerAgentId = input.ownerAgentId ?? "cos";
      const ownerAgentId = ["cos", "dev", "ops", "research", "main"].includes(rawOwnerAgentId) ? rawOwnerAgentId : "cos";
      const [created] = await ctx.db
        .insert(hubTickets)
        .values({
          workspaceId: ctx.workspace.id,
          title: input.title,
          description: input.description,
          status: "todo",
          priority: "normal",
          ownerAgentId,
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
      // Default owner is the coordinator agent.
      const rawOwnerAgentId = input.ownerAgentId ?? "cos";
      const ownerAgentId = ["cos", "dev", "ops", "research", "main"].includes(rawOwnerAgentId) ? rawOwnerAgentId : "cos";
      const [created] = await ctx.db
        .insert(hubTickets)
        .values({
          workspaceId: ctx.workspace.id,
          title: input.title,
          description: input.description,
          priority: input.priority,
          status: "todo",
          ownerAgentId,
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
          ...(input.ownerAgentId !== undefined
            ? {
                ownerAgentId:
                  input.ownerAgentId === null
                    ? null
                    : ["cos", "dev", "ops", "research", "main"].includes(input.ownerAgentId)
                      ? input.ownerAgentId
                      : "cos"
              }
            : {}),
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

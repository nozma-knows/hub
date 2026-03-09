import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

const activeCommandRuns = new Map<string, { runId: string; startedAt: number }>();

function extractCommandAction(output: string):
  | { kind: "create_ticket"; title: string; ownerAgentId?: string; description?: string }
  | null {
  // Expected format from @command:
  // ```hub-action
  // {"kind":"create_ticket","title":"...","ownerAgentId":"dev","description":"..."}
  // ```
  const match = output.match(/```hub-action\s*([\s\S]*?)```/i);
  if (!match) return null;
  const raw = match[1]?.trim();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as any;
    if (parsed?.kind !== "create_ticket") return null;
    if (typeof parsed.title !== "string" || parsed.title.trim().length === 0) return null;
    return {
      kind: "create_ticket",
      title: parsed.title.trim(),
      ownerAgentId: typeof parsed.ownerAgentId === "string" && parsed.ownerAgentId.trim() ? parsed.ownerAgentId.trim() : undefined,
      description: typeof parsed.description === "string" && parsed.description.trim() ? parsed.description.trim() : undefined
    };
  } catch {
    return null;
  }
}

import { hubChannelAgents, hubChannels, hubMessages, hubThreads, hubThreadTickets, hubTickets } from "@/db/schema";
import { openClawAgentTurn } from "@/lib/openclaw/cli-adapter";
import { logAuditEvent } from "@/lib/audit";
import { adminProcedure, createTrpcRouter, protectedProcedure } from "@/server/trpc/init";

export const messagesRouter = createTrpcRouter({
  channelsList: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.query.hubChannels.findMany({
      where: eq(hubChannels.workspaceId, ctx.workspace.id),
      orderBy: (t, { asc }) => [asc(t.name)]
    });

    // Bootstrap: ensure #general exists
    if (rows.length === 0) {
      const [general] = await ctx.db
        .insert(hubChannels)
        .values({ workspaceId: ctx.workspace.id, name: "general", description: "Default channel" })
        .returning();
      return general ? [general] : [];
    }

    return rows;
  }),

  channelCreate: adminProcedure
    .input(
      z.object({
        name: z
          .string()
          .min(1)
          .max(80)
          .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens"),
        description: z.string().optional(),
        agentIds: z.array(z.string()).default([])
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = await ctx.db
        .insert(hubChannels)
        .values({
          workspaceId: ctx.workspace.id,
          name: input.name,
          description: input.description
        })
        .returning();

      if (!created) throw new Error("Failed to create channel");

      if (input.agentIds.length > 0) {
        await ctx.db.insert(hubChannelAgents).values(
          input.agentIds.map((agentId) => ({
            workspaceId: ctx.workspace.id,
            channelId: created.id,
            agentId
          }))
        );
      }

      await logAuditEvent({
        workspaceId: ctx.workspace.id,
        eventType: "messages.channel.create",
        actorUserId: ctx.user!.id,
        result: "success",
        details: { name: input.name }
      });

      return created;
    }),

  channelAgentsGet: protectedProcedure
    .input(z.object({ channelId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.query.hubChannelAgents.findMany({
        where: and(eq(hubChannelAgents.workspaceId, ctx.workspace.id), eq(hubChannelAgents.channelId, input.channelId))
      });
      return rows.map((r) => r.agentId);
    }),

  channelAgentsSet: adminProcedure
    .input(z.object({ channelId: z.string().uuid(), agentIds: z.array(z.string()).default([]) }))
    .mutation(async ({ ctx, input }) => {
      // replace set
      await ctx.db
        .delete(hubChannelAgents)
        .where(and(eq(hubChannelAgents.workspaceId, ctx.workspace.id), eq(hubChannelAgents.channelId, input.channelId)));

      if (input.agentIds.length > 0) {
        await ctx.db.insert(hubChannelAgents).values(
          input.agentIds.map((agentId) => ({
            workspaceId: ctx.workspace.id,
            channelId: input.channelId,
            agentId
          }))
        );
      }

      await logAuditEvent({
        workspaceId: ctx.workspace.id,
        eventType: "messages.channel.agents.set",
        actorUserId: ctx.user!.id,
        result: "success",
        details: { channelId: input.channelId, count: input.agentIds.length }
      });

      return { ok: true };
    }),

  threadsList: protectedProcedure
    .input(z.object({ channelId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const threads = await ctx.db.query.hubThreads.findMany({
        where: and(eq(hubThreads.workspaceId, ctx.workspace.id), eq(hubThreads.channelId, input.channelId)),
        orderBy: (t, { desc: descOrder }) => [descOrder(t.lastMessageAt)]
      });

      if (threads.length === 0) return [];

      const threadIds = threads.map((t) => t.id);
      const lastMessages = await ctx.db.query.hubMessages.findMany({
        where: and(eq(hubMessages.workspaceId, ctx.workspace.id), inArray(hubMessages.threadId, threadIds)),
        orderBy: (t, { desc: descOrder }) => [descOrder(t.createdAt)]
      });

      const lastByThread = new Map<string, string>();
      for (const m of lastMessages) {
        if (!lastByThread.has(m.threadId)) {
          lastByThread.set(m.threadId, m.body);
        }
      }

      return threads.map((t) => ({
        ...t,
        lastMessagePreview: (lastByThread.get(t.id) || "").slice(0, 200)
      }));
    }),

  threadGet: protectedProcedure
    .input(z.object({ threadId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const thread = await ctx.db.query.hubThreads.findFirst({
        where: and(eq(hubThreads.workspaceId, ctx.workspace.id), eq(hubThreads.id, input.threadId))
      });
      if (!thread) throw new Error("Thread not found");

      const messages = await ctx.db.query.hubMessages.findMany({
        where: and(eq(hubMessages.workspaceId, ctx.workspace.id), eq(hubMessages.threadId, input.threadId)),
        orderBy: (t, { asc }) => [asc(t.createdAt)]
      });

      return { thread, messages };
    }),

  threadCreate: protectedProcedure
    .input(
      z.object({
        channelId: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        body: z.string().max(20_000).default("")
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [thread] = await ctx.db
        .insert(hubThreads)
        .values({
          workspaceId: ctx.workspace.id,
          channelId: input.channelId,
          title: input.title,
          status: "open",
          createdByUserId: ctx.user!.id,
          lastMessageAt: new Date()
        })
        .returning();

      if (!thread) throw new Error("Failed to create thread");

      if (input.body.trim().length > 0) {
        await ctx.db.insert(hubMessages).values({
          workspaceId: ctx.workspace.id,
          threadId: thread.id,
          authorType: "human",
          authorUserId: ctx.user!.id,
          body: input.body
        });

        await ctx.db
          .update(hubThreads)
          .set({ lastMessageAt: new Date(), updatedAt: new Date() })
          .where(and(eq(hubThreads.workspaceId, ctx.workspace.id), eq(hubThreads.id, thread.id)));
      }

      await logAuditEvent({
        workspaceId: ctx.workspace.id,
        eventType: "messages.thread.create",
        actorUserId: ctx.user!.id,
        result: "success",
        details: { channelId: input.channelId }
      });

      return { threadId: thread.id };
    }),

  messageSend: protectedProcedure
    .input(z.object({ threadId: z.string().uuid(), body: z.string().min(1).max(20_000) }))
    .mutation(async ({ ctx, input }) => {
      const thread = await ctx.db.query.hubThreads.findFirst({
        where: and(eq(hubThreads.workspaceId, ctx.workspace.id), eq(hubThreads.id, input.threadId))
      });
      if (!thread) throw new Error("Thread not found");

      await ctx.db.insert(hubMessages).values({
        workspaceId: ctx.workspace.id,
        threadId: input.threadId,
        authorType: "human",
        authorUserId: ctx.user!.id,
        body: input.body
      });

      await ctx.db
        .update(hubThreads)
        .set({ lastMessageAt: new Date(), updatedAt: new Date() })
        .where(and(eq(hubThreads.workspaceId, ctx.workspace.id), eq(hubThreads.id, input.threadId)));

      const shouldInvoke = /(^|\s)@command(\b|\s)/i.test(input.body);
      if (shouldInvoke) {
        // Prevent piling up concurrent runs for the same thread.
        if (activeCommandRuns.has(input.threadId)) {
          return { ok: true, invoked: true, alreadyRunning: true };
        }

        const runId = randomUUID();
        activeCommandRuns.set(input.threadId, { runId, startedAt: Date.now() });

        // Immediately reflect that the agent is working (Slack-like typing indicator)
        await ctx.db.insert(hubMessages).values({
          workspaceId: ctx.workspace.id,
          threadId: input.threadId,
          authorType: "system",
          body: `@command is thinking… (${runId.slice(0, 6)})`,
          createdAt: new Date()
        });

        // Fire-and-forget: continue work after responding to the client.
        void (async () => {
          const prefix = runId.slice(0, 6);
          const heartbeat = setInterval(async () => {
            try {
              await ctx.db.insert(hubMessages).values({
                workspaceId: ctx.workspace.id,
                threadId: input.threadId,
                authorType: "system",
                body: `@command is still thinking… (${prefix})`,
                createdAt: new Date()
              });
              await ctx.db
                .update(hubThreads)
                .set({ lastMessageAt: new Date(), updatedAt: new Date() })
                .where(and(eq(hubThreads.workspaceId, ctx.workspace.id), eq(hubThreads.id, input.threadId)));
            } catch {
              // ignore
            }
          }, 8000);

          try {
            const recent = await ctx.db.query.hubMessages.findMany({
          where: and(eq(hubMessages.workspaceId, ctx.workspace.id), eq(hubMessages.threadId, input.threadId)),
          orderBy: (t, { desc: descOrder }) => [descOrder(t.createdAt)],
          limit: 20
        });

            const context = recent
              .slice()
              .reverse()
              .map((m) =>
                `${m.authorType === "agent" ? `agent:${m.authorAgentId ?? "?"}` : `user:${m.authorUserId ?? "?"}`}: ${m.body}`
              )
              .join("\n");

            const prompt = `You are @command (Chief of Staff) inside OpenClaw Hub.

Thread title: ${thread.title ?? "(none)"}

Recent messages:
${context}

Instructions:
- Be concise and action-oriented.
- If this should become a ticket, you have two options:
  1) Suggest only: propose a title + owner agent id (ops/dev/pm/research) and ask for confirmation.
  2) Create it now: include EXACTLY ONE action block in your reply.

Format for creating:
- Include a fenced code block with language "hub-action" containing JSON:
  {"kind":"create_ticket","title":"...","ownerAgentId":"dev","description":"..."}

Rules:
- NEVER claim you created a ticket unless you include the hub-action block.
- If you need clarification, ask at most 1-2 questions.`;

            const result = await openClawAgentTurn({ agentId: "cos", message: prompt, timeoutSeconds: 300 });
            const output = (result.output || result.message || result.text || "").toString().trim();

            // Remove the typing/progress indicators for this run
            try {
              const prefix = runId.slice(0, 6);
              await ctx.db
                .delete(hubMessages)
                .where(
                  and(
                    eq(hubMessages.workspaceId, ctx.workspace.id),
                    eq(hubMessages.threadId, input.threadId),
                    eq(hubMessages.authorType, "system"),
                    inArray(hubMessages.body, [
                      `@command is thinking… (${prefix})`,
                      `@command is still thinking… (${prefix})`
                    ])
                  )
                );
            } catch {
              // ignore
            }

            if (output) {
              const action = extractCommandAction(output);

              if (action?.kind === "create_ticket") {
                const ownerAgentId = action.ownerAgentId ?? "cos";
                const [ticket] = await ctx.db
                  .insert(hubTickets)
                  .values({
                    workspaceId: ctx.workspace.id,
                    title: action.title,
                    description: action.description ?? `Created by @command from channel thread: ${thread.title ?? "(no title)"}`,
                    status: "todo",
                    priority: "normal",
                    ownerAgentId,
                    createdByUserId: ctx.user!.id
                  })
                  .returning();

                if (ticket) {
                  await ctx.db.insert(hubThreadTickets).values({
                    workspaceId: ctx.workspace.id,
                    threadId: input.threadId,
                    ticketId: ticket.id
                  });

                  await logAuditEvent({
                    workspaceId: ctx.workspace.id,
                    eventType: "tickets.createFromCommand",
                    actorUserId: ctx.user!.id,
                    agentId: "cos",
                    result: "success",
                    details: { ticketId: ticket.id, threadId: input.threadId }
                  });

                  // Post a confirmation message.
                  await ctx.db.insert(hubMessages).values({
                    workspaceId: ctx.workspace.id,
                    threadId: input.threadId,
                    authorType: "system",
                    body: `✅ Ticket created: "${ticket.title}" (Todo) · owner: ${ticket.ownerAgentId}. See /tickets.`
                  });
                }
              }

              await ctx.db.insert(hubMessages).values({
                workspaceId: ctx.workspace.id,
                threadId: input.threadId,
                authorType: "agent",
                authorAgentId: "cos",
                body: output
              });

              await ctx.db
                .update(hubThreads)
                .set({ lastMessageAt: new Date(), updatedAt: new Date() })
                .where(and(eq(hubThreads.workspaceId, ctx.workspace.id), eq(hubThreads.id, input.threadId)));
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            // eslint-disable-next-line no-console
            console.error("@command run failed", { msg });

            // Best-effort: surface failure
            try {
              const prefix = runId.slice(0, 6);
              await ctx.db.insert(hubMessages).values({
                workspaceId: ctx.workspace.id,
                threadId: input.threadId,
                authorType: "system",
                body: `@command failed to respond (${prefix}). Error: ${msg.slice(0, 180)}`,
                createdAt: new Date()
              });
            } catch {
              // ignore
            }
          } finally {
            clearInterval(heartbeat);
            activeCommandRuns.delete(input.threadId);
          }
        })();

        return { ok: true, invoked: true, async: true };
      }

      return { ok: true, invoked: false };
    })
});

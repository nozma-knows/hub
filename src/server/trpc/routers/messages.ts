import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { hubChannelAgents, hubChannels, hubMessages, hubThreads } from "@/db/schema";
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
      return ctx.db.query.hubThreads.findMany({
        where: and(eq(hubThreads.workspaceId, ctx.workspace.id), eq(hubThreads.channelId, input.channelId)),
        orderBy: (t, { desc: descOrder }) => [descOrder(t.lastMessageAt)]
      });
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
        body: z.string().min(1).max(20_000)
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

      await ctx.db.insert(hubMessages).values({
        workspaceId: ctx.workspace.id,
        threadId: thread.id,
        authorType: "human",
        authorUserId: ctx.user!.id,
        body: input.body
      });

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

      return { ok: true };
    })
});

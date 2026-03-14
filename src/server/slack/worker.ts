import "dotenv/config";

import { App, LogLevel } from "@slack/bolt";
import { and, eq } from "drizzle-orm";

import {
  hubChannels,
  hubMessages,
  hubSlackThreads,
  hubThreads,
  hubTickets
} from "@/db/schema";
import { db } from "@/lib/db";
import { openClawAgentTurn } from "@/lib/openclaw/cli-adapter";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

const SLACK_BOT_TOKEN = requireEnv("SLACK_BOT_TOKEN");
const SLACK_APP_TOKEN = requireEnv("SLACK_APP_TOKEN");
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || "";

async function ensureSlackChannel(workspaceId: string) {
  // Create/find a single public channel "slack" to hold imported Slack conversations.
  const existing = await db.query.hubChannels.findFirst({
    where: and(eq(hubChannels.workspaceId, workspaceId), eq(hubChannels.name, "slack"))
  });
  if (existing) return existing;

  const [created] = await db
    .insert(hubChannels)
    .values({
      workspaceId,
      name: "slack",
      description: "Imported from Slack (Socket Mode)",
      kind: "public"
    })
    .returning();
  if (!created) throw new Error("Failed to create slack hub channel");
  return created;
}

async function getOrCreateThread(params: {
  workspaceId: string;
  slackTeamId: string;
  slackChannelId: string;
  slackThreadTs: string;
  title?: string | null;
}) {
  const map = await db.query.hubSlackThreads.findFirst({
    where: and(
      eq(hubSlackThreads.workspaceId, params.workspaceId),
      eq(hubSlackThreads.slackTeamId, params.slackTeamId),
      eq(hubSlackThreads.slackChannelId, params.slackChannelId),
      eq(hubSlackThreads.slackThreadTs, params.slackThreadTs)
    )
  });

  if (map) {
    const thread = await db.query.hubThreads.findFirst({
      where: and(eq(hubThreads.workspaceId, params.workspaceId), eq(hubThreads.id, map.hubThreadId))
    });
    if (thread) return { thread, hubThreadId: thread.id };
  }

  const hubChannel = await ensureSlackChannel(params.workspaceId);

  const [thread] = await db
    .insert(hubThreads)
    .values({
      workspaceId: params.workspaceId,
      channelId: hubChannel.id,
      title: params.title ?? null,
      status: "open",
      createdByUserId: null,
      lastMessageAt: new Date()
    })
    .returning();

  if (!thread) throw new Error("Failed to create hub thread");

  await db.insert(hubSlackThreads).values({
    workspaceId: params.workspaceId,
    slackTeamId: params.slackTeamId,
    slackChannelId: params.slackChannelId,
    slackThreadTs: params.slackThreadTs,
    hubThreadId: thread.id,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  return { thread, hubThreadId: thread.id };
}

function buildCommandPrompt(args: { threadTitle?: string | null; recentContext: string }) {
  return `You are @command (Chief of Staff) inside OpenClaw Hub.

Thread title: ${args.threadTitle ?? "(none)"}

Recent messages:
${args.recentContext}

Instructions:
- Be concise and action-oriented.
- If this should become a ticket, you have two options:
  1) Suggest only: propose a title + owner agent id (cos/dev/ops/research) and ask for confirmation.
  2) Create it now: include EXACTLY ONE action block in your reply.

Format for creating:
- Include a fenced code block with language "hub-action" containing JSON:
  {"kind":"create_ticket","title":"...","ownerAgentId":"dev","description":"..."}

Rules:
- NEVER claim you created a ticket unless you include the hub-action block.
- If you need clarification, ask at most 1-2 questions.`;
}

function extractCommandAction(text: string): any | null {
  const re = /```hub-action\s*([\s\S]*?)```/i;
  const m = text.match(re);
  if (!m) return null;
  try {
    return JSON.parse(m[1].trim());
  } catch {
    return null;
  }
}

async function runCommandOnThread(workspaceId: string, threadId: string) {
  const thread = await db.query.hubThreads.findFirst({
    where: and(eq(hubThreads.workspaceId, workspaceId), eq(hubThreads.id, threadId))
  });
  if (!thread) throw new Error("Thread not found");

  const recent = await db.query.hubMessages.findMany({
    where: and(eq(hubMessages.workspaceId, workspaceId), eq(hubMessages.threadId, threadId)),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 20
  });

  const context = recent
    .slice()
    .reverse()
    .map((m) => `${m.authorType === "agent" ? `agent:${m.authorAgentId ?? "?"}` : "human"}: ${m.body}`)
    .join("\n");

  const prompt = buildCommandPrompt({ threadTitle: thread.title, recentContext: context });
  const result = await openClawAgentTurn({ agentId: "cos", message: prompt, timeoutSeconds: 300 });
  const output = (result.output || result.message || result.text || "").toString().trim();
  if (!output) return { output: "(no output)", createdTicketId: null };

  // Save the @command output into the thread.
  await db.insert(hubMessages).values({
    workspaceId,
    threadId,
    authorType: "agent",
    authorAgentId: "cos",
    body: output,
    createdAt: new Date()
  });

  await db
    .update(hubThreads)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(and(eq(hubThreads.workspaceId, workspaceId), eq(hubThreads.id, threadId)));

  const action = extractCommandAction(output);
  if (action?.kind !== "create_ticket") return { output, createdTicketId: null };

  const rawOwnerAgentId = action.ownerAgentId ?? "cos";
  const ownerAgentId = ["cos", "dev", "ops", "research", "main"].includes(rawOwnerAgentId) ? rawOwnerAgentId : "cos";

  const [ticket] = await db
    .insert(hubTickets)
    .values({
      workspaceId,
      title: String(action.title ?? "Untitled"),
      description: action.description ? String(action.description) : null,
      status: "todo",
      priority: "normal",
      ownerAgentId,
      createdByUserId: null
    })
    .returning();

  if (ticket) {
    await db.insert(hubMessages).values({
      workspaceId,
      threadId,
      authorType: "agent",
      authorAgentId: "cos",
      body: `✅ Created ticket: ${ticket.title}\nOpen: /tickets?open=${ticket.id}`,
      createdAt: new Date()
    });
  }

  return { output, createdTicketId: ticket?.id ?? null };
}

async function getDefaultWorkspaceId(): Promise<string> {
  // For now, use the first workspace. Single-user deployment assumption.
  const rows: any = await db.execute(
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    // @ts-ignore
    {
      sql: "select id from workspaces order by created_at asc limit 1",
      params: []
    } as any
  );
  const id = (rows?.rows?.[0]?.id ?? rows?.[0]?.id) as string | undefined;
  if (!id) throw new Error("No workspace found");
  return id;
}

async function main() {
  const workspaceId = await getDefaultWorkspaceId();

  const app = new App({
    token: SLACK_BOT_TOKEN,
    appToken: SLACK_APP_TOKEN,
    signingSecret: SLACK_SIGNING_SECRET || "dummy",
    socketMode: true,
    logLevel: LogLevel.INFO
  });

  app.event("app_mention", async ({ event, client }) => {
    const e: any = event;
    const text: string = e.text || "";
    const channel: string = e.channel;
    const threadTs: string = e.thread_ts || e.ts;
    const team: string = e.team || "";

    // Insert message as human into hub thread mapped to Slack thread.
    const { hubThreadId } = await getOrCreateThread({
      workspaceId,
      slackTeamId: team,
      slackChannelId: channel,
      slackThreadTs: threadTs,
      title: `Slack ${channel}`
    });

    await db.insert(hubMessages).values({
      workspaceId,
      threadId: hubThreadId,
      authorType: "human",
      authorUserId: null,
      body: text,
      createdAt: new Date()
    });

    await db
      .update(hubThreads)
      .set({ lastMessageAt: new Date(), updatedAt: new Date() })
      .where(and(eq(hubThreads.workspaceId, workspaceId), eq(hubThreads.id, hubThreadId)));

    // Run @command and post response back into Slack thread.
    const result = await runCommandOnThread(workspaceId, hubThreadId);

    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: result.output.slice(0, 3900)
    });
  });

  app.message(async ({ message, client }) => {
    const m: any = message;
    if (m.subtype) return;
    // Only handle DMs (im). Slack Bolt provides channel_type in events sometimes.
    if (m.channel_type && m.channel_type !== "im") return;

    const channel: string = m.channel;
    const threadTs: string = m.thread_ts || m.ts;
    const team: string = (m.team as string) || "";
    const text: string = m.text || "";

    const { hubThreadId } = await getOrCreateThread({
      workspaceId,
      slackTeamId: team,
      slackChannelId: channel,
      slackThreadTs: threadTs,
      title: `Slack DM ${channel}`
    });

    await db.insert(hubMessages).values({
      workspaceId,
      threadId: hubThreadId,
      authorType: "human",
      authorUserId: null,
      body: text,
      createdAt: new Date()
    });

    await db
      .update(hubThreads)
      .set({ lastMessageAt: new Date(), updatedAt: new Date() })
      .where(and(eq(hubThreads.workspaceId, workspaceId), eq(hubThreads.id, hubThreadId)));

    // Run @command on every DM message.
    const result = await runCommandOnThread(workspaceId, hubThreadId);

    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: result.output.slice(0, 3900)
    });
  });

  await app.start();
  console.log("[hub-slack] Socket Mode worker started");
}

main().catch((e) => {
  console.error("[hub-slack] fatal", e);
  process.exit(1);
});

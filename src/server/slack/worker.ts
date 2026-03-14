import "dotenv/config";

import { App, LogLevel } from "@slack/bolt";
import { writeFile } from "node:fs/promises";

import { openClawAgentTurn } from "@/lib/openclaw/cli-adapter";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

const SLACK_BOT_TOKEN = requireEnv("SLACK_BOT_TOKEN");
const SLACK_APP_TOKEN = requireEnv("SLACK_APP_TOKEN");
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || "";

function stripBotMentionAndCommand(rawText: string) {
  return (rawText || "")
    .replace(/^<@[^>]+>\s*/i, "")
    .replace(/^(?:@command\b\s*)/i, "")
    .trim();
}

async function buildPromptFromSlackThread(args: {
  client: any;
  channel: string;
  threadTs: string;
  incomingText: string;
}) {
  // Slack-native backbone approach:
  // Use Slack thread itself as the context source of truth.
  // Pull a small window of the thread and ask @command to reply.
  let contextLines: string[] = [];

  try {
    const replies = await args.client.conversations.replies({
      channel: args.channel,
      ts: args.threadTs,
      limit: 12,
    });

    const msgs = Array.isArray(replies?.messages) ? replies.messages : [];
    // Keep only a compact context of text messages.
    contextLines = msgs
      .map((m: any) => {
        const who = m.user ? `user:${m.user}` : m.bot_id ? `bot:${m.bot_id}` : "unknown";
        const text = typeof m.text === "string" ? m.text : "";
        return `${who}: ${text}`.trim();
      })
      .filter(Boolean)
      .slice(-10);
  } catch {
    // If we can't fetch replies (permissions/rate limiting), fall back to just the incoming message.
    contextLines = [];
  }

  const context = contextLines.length ? contextLines.join("\n") : `user: ${args.incomingText}`;

  return `You are @command (Chief of Staff).

You are responding inside Slack.

Conversation context (Slack thread):
${context}

Task:
- Reply helpfully to the latest user message.
- Be concise.
- If you need clarification, ask at most 1-2 questions.
- If the user wants a task tracked, suggest creating a Hub ticket (but do NOT claim you created one here).`;
}

async function runCommand(prompt: string) {
  const result = await openClawAgentTurn({ agentId: "cos", message: prompt, timeoutSeconds: 300 });
  const output = (result.output || result.message || result.text || "").toString().trim();

  if (!output) {
    const dbg = {
      status: (result as any)?.status,
      runId: (result as any)?.runId,
      hasPayloads: Array.isArray((result as any)?.result?.payloads),
      payloadCount: (result as any)?.result?.payloads?.length,
      rawKeys: Object.keys(result as any),
    };

    try {
      const ts = Date.now();
      await writeFile(
        `/root/.openclaw/workspace/hub/tmp/slack-empty-output-${ts}.json`,
        JSON.stringify({ dbg, result }, null, 2),
        "utf8"
      );
    } catch {
      // ignore
    }

    return {
      output:
        "I got your message, but I failed to produce a reply (empty agent output). Try again in a moment.",
      debug: dbg,
    };
  }

  return { output, debug: null };
}

async function withEyesThenCheckmark(args: {
  client: any;
  channel: string;
  timestamp: string;
  fn: () => Promise<void>;
}) {
  // Ack: 👀
  try {
    await args.client.reactions.add({ channel: args.channel, name: "eyes", timestamp: args.timestamp });
  } catch {
    // ignore
  }

  try {
    await args.fn();
  } finally {
    // Done: remove 👀 and add ✅
    try {
      await args.client.reactions.remove({ channel: args.channel, name: "eyes", timestamp: args.timestamp });
    } catch {
      // ignore
    }
    try {
      await args.client.reactions.add({
        channel: args.channel,
        name: "white_check_mark",
        timestamp: args.timestamp,
      });
    } catch {
      // ignore
    }
  }
}

async function main() {
  const app = new App({
    token: SLACK_BOT_TOKEN,
    appToken: SLACK_APP_TOKEN,
    signingSecret: SLACK_SIGNING_SECRET || "dummy",
    socketMode: true,
    logLevel: LogLevel.INFO,
  });

  // CHANNELS: respond to @Hub mentions (no @command required)
  app.event("app_mention", async ({ event, client }) => {
    const e: any = event;
    const channel: string = e.channel;
    const team: string = e.team || "";
    const threadTs: string = e.thread_ts || e.ts;

    const incomingText = stripBotMentionAndCommand(e.text || "");
    if (!incomingText) return;

    await withEyesThenCheckmark({
      client,
      channel,
      timestamp: e.ts,
      fn: async () => {
        const prompt = await buildPromptFromSlackThread({
          client,
          channel,
          threadTs,
          incomingText,
        });

        const { output } = await runCommand(prompt);

        await client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: output.slice(0, 3900),
        });
      },
    });
  });

  // DMs: respond to every DM message
  app.message(async ({ message, client }) => {
    const m: any = message;
    if (m.subtype) return;
    if (m.channel_type && m.channel_type !== "im") return;

    const channel: string = m.channel;
    const threadTs: string = m.thread_ts || m.ts;
    const incomingText: string = (m.text || "").trim();
    if (!incomingText) return;

    await withEyesThenCheckmark({
      client,
      channel,
      timestamp: m.ts,
      fn: async () => {
        const prompt = await buildPromptFromSlackThread({
          client,
          channel,
          threadTs,
          incomingText,
        });

        const { output } = await runCommand(prompt);

        await client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: output.slice(0, 3900),
        });
      },
    });
  });

  await app.start();
  console.log("[hub-slack] Socket Mode worker started (slack-native backbone mode)");
}

main().catch((e) => {
  console.error("[hub-slack] fatal", e);
  process.exit(1);
});

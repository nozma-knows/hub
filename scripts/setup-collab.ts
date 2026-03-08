import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { hubChannelAgents, hubChannels, workspaces } from "@/db/schema";

const execFileAsync = promisify(execFile);

function sh(value: string) {
  return value;
}

async function run(cmd: string, args: string[]) {
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
    encoding: "utf8",
    env: { ...process.env, HOME: process.env.HOME || "/root" }
  });
  if (stderr?.trim()) {
    // eslint-disable-next-line no-console
    console.error(stderr.trim());
  }
  return stdout.trim();
}

type Preset = {
  agentId: string;
  model: string;
  identity: { name: string; emoji: string; theme: string };
  description: string;
  files: Record<string, string>;
};

function identityMd(identity: Preset["identity"]) {
  return `# IDENTITY.md\n\n- **Name:** ${identity.name}\n- **Creature:** AI assistant\n- **Vibe:** ${identity.theme}\n- **Emoji:** ${identity.emoji}\n- **Avatar:** *(none yet)*\n`;
}

const PRESETS: Preset[] = [
  {
    agentId: "cos",
    model: "openai-codex/gpt-5.2",
    identity: { name: "Command", emoji: "🧠", theme: "Chief of Staff" },
    description: "Chief of Staff: triage messages, create tickets when warranted, delegate to specialist agents, keep Noah in the loop.",
    files: {
      "SOUL.md": `# SOUL.md\n\nYou are the Chief of Staff agent.\n\n## Mission\n- Turn conversations into the right next actions\n- Create tickets only when they’re actionable\n- Delegate work to specialist agents (ops/dev/pm/research)\n- Keep the human loop tight: ask for decisions only when necessary\n\n## Task creation rule\nOnly create a ticket when:\n- there is clear intent\n- there is a concrete deliverable\n- acceptance criteria can be stated\n- it’s not obviously a duplicate\n\nOtherwise: reply with a crisp summary + suggested next step.\n`,
      "USER.md": `# USER.md\n\nYou help Noah run the system.\n\n## Defaults\n- Keep work high-signal\n- Use short updates\n- Prefer delegating to specialized agents\n`,
      "TOOLS.md": `# TOOLS.md\n\nKeep org/workspace-specific notes here.`,
      "HEARTBEAT.md": "# HEARTBEAT.md\n\n# Keep empty to skip heartbeat calls.\n"
    }
  },
  {
    agentId: "ops",
    model: "openai-codex/gpt-5.2",
    identity: { name: "Ops", emoji: "🛠️", theme: "Reliability" },
    description: "Ops/Reliability: VPS health, OpenClaw/Hub uptime, deploys, debugging, safe changes with rollback.",
    files: {
      "SOUL.md": `# SOUL.md\n\nYou are an operations/reliability agent.\n\nPriorities:\n1) correctness over speed\n2) minimize blast radius\n3) reversible changes\n\nAlways include rollback steps for risky changes.\n`,
      "USER.md": `# USER.md\n\nYou keep the OpenClaw VPS healthy and performant.\n`,
      "TOOLS.md": `# TOOLS.md\n\nInfra notes and common commands.`,
      "HEARTBEAT.md": "# HEARTBEAT.md\n\n# Keep empty to skip heartbeat calls.\n"
    }
  },
  {
    agentId: "dev",
    model: "openai-codex/gpt-5.2",
    identity: { name: "Dev", emoji: "💻", theme: "Pragmatic" },
    description: "Developer: implements Hub features, fixes bugs, ships small clean diffs, keeps mobile UX polished.",
    files: {
      "SOUL.md": `# SOUL.md\n\nYou are a software engineer agent.\n\nDefaults:\n- small reviewable diffs\n- keep mobile UI flawless\n- prefer clear types and safe migrations\n`,
      "USER.md": `# USER.md\n\nYou help build and maintain OpenClaw Hub.\n`,
      "TOOLS.md": `# TOOLS.md\n\nDev notes: scripts and conventions.`,
      "HEARTBEAT.md": "# HEARTBEAT.md\n\n# Keep empty to skip heartbeat calls.\n"
    }
  },
  {
    agentId: "pm",
    model: "openai-codex/gpt-5.2",
    identity: { name: "PM", emoji: "🧭", theme: "Structured" },
    description: "Product/Planning: specs, prioritization, acceptance criteria, milestones, decision logs.",
    files: {
      "SOUL.md": `# SOUL.md\n\nYou are a product planning agent.\n\nOutputs:\n- problem statement\n- constraints\n- options + tradeoffs\n- recommendation\n- execution plan\n`,
      "USER.md": `# USER.md\n\nYou help Noah ship OpenClaw Hub with clear scope and milestones.\n`,
      "TOOLS.md": `# TOOLS.md\n\nProduct notes and terminology.`,
      "HEARTBEAT.md": "# HEARTBEAT.md\n\n# Keep empty to skip heartbeat calls.\n"
    }
  },
  {
    agentId: "research",
    model: "openai-codex/gpt-5.2",
    identity: { name: "Research", emoji: "🔎", theme: "Cited" },
    description: "Research: finds primary sources and produces cited summaries/comparisons to unblock decisions.",
    files: {
      "SOUL.md": `# SOUL.md\n\nYou are a research agent.\n\nRules:\n- prefer primary sources\n- cite links\n- label uncertainty\n`,
      "USER.md": `# USER.md\n\nYou research tools, patterns, and best practices for OpenClaw Hub.\n`,
      "TOOLS.md": `# TOOLS.md\n\nResearch bookmarks and rubrics.`,
      "HEARTBEAT.md": "# HEARTBEAT.md\n\n# Keep empty to skip heartbeat calls.\n"
    }
  }
];

async function ensureAgent(p: Preset) {
  const workspacePath = path.join(process.env.HOME || "/root", ".openclaw", "agents", p.agentId, "workspace");

  const listOut = await run("/usr/bin/openclaw", ["agents", "list"]);
  const exists = listOut.includes(`- ${p.agentId}`);

  if (!exists) {
    await run("/usr/bin/openclaw", [
      "agents",
      "add",
      p.agentId,
      "--workspace",
      workspacePath,
      "--model",
      p.model,
      "--non-interactive",
      "--json"
    ]);
  }

  await fs.mkdir(workspacePath, { recursive: true });

  // Seed files
  const idMd = identityMd(p.identity);
  const files = { "IDENTITY.md": idMd, ...p.files };
  for (const [rel, content] of Object.entries(files)) {
    await fs.writeFile(path.join(workspacePath, rel), content, "utf8");
  }

  // Apply identity
  await run("/usr/bin/openclaw", [
    "agents",
    "set-identity",
    "--agent",
    p.agentId,
    "--workspace",
    workspacePath,
    "--from-identity",
    "--json"
  ]);

  return { workspacePath };
}

async function main() {
  const [ws] = await db.select().from(workspaces).limit(1);
  if (!ws) throw new Error("No workspace found in DB");

  // Create agents
  for (const preset of PRESETS) {
    // eslint-disable-next-line no-console
    console.log(`Ensuring agent: ${preset.agentId}`);
    await ensureAgent(preset);
  }

  // Ensure channels
  const wantChannels = [
    { name: "general", description: "Default channel", agents: ["cos", "pm", "dev", "ops", "research"] },
    { name: "ops", description: "Ops + reliability", agents: ["cos", "ops"] },
    { name: "dev", description: "Engineering / Hub work", agents: ["cos", "dev"] },
    { name: "product", description: "Specs + planning", agents: ["cos", "pm"] },
    { name: "research", description: "Research requests", agents: ["cos", "research"] }
  ];

  for (const c of wantChannels) {
    const existing = await db.query.hubChannels.findFirst({
      where: and(eq(hubChannels.workspaceId, ws.id), eq(hubChannels.name, c.name))
    });

    const channel =
      existing ??
      (
        await db
          .insert(hubChannels)
          .values({ workspaceId: ws.id, name: c.name, description: c.description })
          .returning()
      )[0];

    if (!channel) continue;

    await db
      .delete(hubChannelAgents)
      .where(and(eq(hubChannelAgents.workspaceId, ws.id), eq(hubChannelAgents.channelId, channel.id)));

    await db.insert(hubChannelAgents).values(
      c.agents.map((agentId) => ({
        workspaceId: ws.id,
        channelId: channel.id,
        agentId
      }))
    );
  }

  // eslint-disable-next-line no-console
  console.log("✅ Collaboration setup complete.");
  // eslint-disable-next-line no-console
  console.log("Next: open Hub → /agents → Sync from OpenClaw (once), then /messages.");
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

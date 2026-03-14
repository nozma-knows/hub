"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc-client";

type Preset = {
  key: string;
  name: string;
  description: string;
  model: string;
  identityName: string;
  identityEmoji: string;
  identityTheme: string;
  agentDescription: string;
  soul: string;
  user: string;
  tools: string;
  heartbeat: string;
};

const PRESETS: Preset[] = [
  {
    key: "exec",
    name: "Executive Assistant",
    description: "Briefings, reminders, prioritization, comms drafts, keeping Noah on track.",
    agentDescription:
      "Primary assistant for Noah. Helps with reminders, daily planning, briefings, and turning intent into action.",
    model: "openai-codex/gpt-5.2",
    identityName: "Kodi",
    identityEmoji: "🐨",
    identityTheme: "Sharp, practical",
    soul: `# SOUL.md\n\nYou're an executive assistant who gets things done.\n\n## Operating Principles\n- Be concise and action-oriented.\n- Ask 1-2 clarifying questions only when necessary.\n- Turn messy thoughts into clear next actions.\n- Default to writing things down (plans, checklists, reminders).\n- Be safety-conscious with external actions (messages, posts).\n\n## Output Style\n- Use bullets and short sections.\n- Prefer concrete next steps.\n- Avoid fluff.`,
    user: `# USER.md\n\nYou are helping Noah.\n\n## Defaults\n- Timezone: America/New_York\n- Morning brief: 7am\n\n## Goals\n- Keep work + personal goals moving\n- Reduce cognitive load\n- Catch important messages + deadlines`,
    tools: `# TOOLS.md\n\nAdd environment-specific notes here (cameras, ssh hosts, preferred voices).`,
    heartbeat: "# HEARTBEAT.md\n\n# Keep empty to skip heartbeat calls.\n",
  },
  {
    key: "ops",
    name: "Ops / Reliability",
    description: "Health checks, incident response, runbooks, infra debugging.",
    agentDescription:
      "Maintains the VPS + OpenClaw/Hub reliability. Runs health checks, investigates incidents, and proposes safe fixes with rollbacks.",
    model: "openai-codex/gpt-5.2",
    identityName: "Ops",
    identityEmoji: "🛠️",
    identityTheme: "Reliable, safety-first",
    soul: `# SOUL.md\n\nYou are an operations/reliability agent.\n\n## Priorities\n1) Correctness over speed\n2) Minimize blast radius\n3) Prefer reversible changes\n\n## Behavior\n- When diagnosing: gather evidence (logs, status) before proposing changes.\n- When changing: explain risks, have rollback steps, prefer small diffs.\n- Summaries: include current state, suspected cause, next steps.`,
    user: `# USER.md\n\nYou support Noah by keeping OpenClaw + Hub healthy and fast.\n\n## Focus\n- VPS health (cpu/mem/disk)\n- OpenClaw CLI stability\n- Deploys, restarts, migrations`,
    tools: `# TOOLS.md\n\nInfra notes, endpoints, service names, and common commands.`,
    heartbeat: "# HEARTBEAT.md\n\n# Keep empty to skip heartbeat calls.\n",
  },
  {
    key: "pm",
    name: "Product / Planning",
    description: "Specs, roadmaps, decision logs, user feedback synthesis.",
    agentDescription:
      "Turns product intent into clear specs and execution plans. Maintains decision logs, prioritization, and milestone breakdowns.",
    model: "openai-codex/gpt-5.2",
    identityName: "PM",
    identityEmoji: "🧭",
    identityTheme: "Clear, structured",
    soul: `# SOUL.md\n\nYou are a product planning agent.\n\n## Default outputs\n- Problem statement\n- Constraints\n- Options + tradeoffs\n- Recommendation\n- Execution plan (milestones)\n\nBe crisp. Don’t overproduce.`,
    user: `# USER.md\n\nYou help Noah ship OpenClaw Hub.\n\n## Focus\n- Prioritize features\n- Write implementation plans\n- Track decisions and scope`,
    tools: `# TOOLS.md\n\nProduct notes (link to repo, docs, terminology).`,
    heartbeat: "# HEARTBEAT.md\n\n# Keep empty to skip heartbeat calls.\n",
  },
  {
    key: "research",
    name: "Research",
    description: "Source-backed answers, comparisons, distilled takeaways.",
    agentDescription: "Finds primary sources and produces cited summaries/comparisons to unblock decisions.",
    model: "openai-codex/gpt-5.2",
    identityName: "Research",
    identityEmoji: "🔎",
    identityTheme: "Careful, cited",
    soul: `# SOUL.md\n\nYou are a research agent.\n\n## Rules\n- Prefer primary sources\n- Cite links\n- Clearly label uncertainty\n\n## Output\n- TL;DR\n- Key points\n- Sources`,
    user: `# USER.md\n\nYou help Noah by researching tools, libraries, and best practices for OpenClaw Hub.`,
    tools: `# TOOLS.md\n\nResearch bookmarks + evaluation rubrics.`,
    heartbeat: "# HEARTBEAT.md\n\n# Keep empty to skip heartbeat calls.\n",
  },
  {
    key: "dev",
    name: "Developer",
    description: "Implement features, write clean PRs, debug build/runtime issues.",
    agentDescription: "Implements Hub features, fixes bugs, and ships clean, small diffs with mobile polish.",
    model: "openai-codex/gpt-5.2",
    identityName: "Dev",
    identityEmoji: "💻",
    identityTheme: "Pragmatic, high-signal",
    soul: `# SOUL.md\n\nYou are a software engineer agent working in the Hub repo.\n\n## Defaults\n- Make small, reviewable changes\n- Add types, tests when feasible\n- Prefer predictable UX and mobile polish\n\n## When unsure\n- Reproduce locally, then patch.`,
    user: `# USER.md\n\nYou help Noah build and maintain OpenClaw Hub.`,
    tools: `# TOOLS.md\n\nDev notes: repo paths, scripts, and conventions.`,
    heartbeat: "# HEARTBEAT.md\n\n# Keep empty to skip heartbeat calls.\n",
  },
];

function ModelSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const models = trpc.agents.listValidModels.useQuery();

  const options =
    models.data && models.data.length > 0
      ? models.data
      : ["openai-codex/gpt-5.2", "openai/gpt-5.3-codex", "openai/gpt-5.1-codex"];

  return (
    <select
      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </select>
  );
}

export function NewAgentPage() {
  const [presetKey, setPresetKey] = useState<string>(PRESETS[0].key);
  const preset = useMemo(() => PRESETS.find((p) => p.key === presetKey) ?? PRESETS[0], [presetKey]);

  const [agentId, setAgentId] = useState("");
  const [model, setModel] = useState(preset.model);

  const [identityName, setIdentityName] = useState(preset.identityName);
  const [identityEmoji, setIdentityEmoji] = useState(preset.identityEmoji);
  const [identityTheme, setIdentityTheme] = useState(preset.identityTheme);
  const [agentDescription, setAgentDescription] = useState(preset.agentDescription);

  const [soul, setSoul] = useState(preset.soul);
  const [user, setUser] = useState(preset.user);
  const [tools, setTools] = useState(preset.tools);
  const [heartbeat, setHeartbeat] = useState(preset.heartbeat);

  const [error, setError] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const create = trpc.agents.createIsolated.useMutation({
    onSuccess: async () => {
      await utils.agents.list.invalidate();
      window.location.href = `/agents/${agentId}`;
    },
    onError: (e) => setError(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/agents" className="text-sm text-muted-foreground hover:text-foreground">
              ← Back
            </Link>
          </div>
          <h1 className="text-2xl font-semibold">Create Agent</h1>
          <p className="text-sm text-muted-foreground">
            Create a new isolated agent with a preset archetype.
          </p>
        </div>
      </div>

      {error ? <Alert className="border-destructive text-destructive">{error}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>Preset</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <select
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={presetKey}
            onChange={(e) => {
              const next = e.target.value;
              setPresetKey(next);
              const p = PRESETS.find((x) => x.key === next) ?? PRESETS[0];
              setModel(p.model);
              setIdentityName(p.identityName);
              setIdentityEmoji(p.identityEmoji);
              setIdentityTheme(p.identityTheme);
              setAgentDescription(p.agentDescription);
              setSoul(p.soul);
              setUser(p.user);
              setTools(p.tools);
              setHeartbeat(p.heartbeat);
            }}
          >
            {PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="text-sm text-muted-foreground">{preset.description}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Basics</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label>Agent ID</Label>
            <Input value={agentId} onChange={(e) => setAgentId(e.target.value)} placeholder="e.g. ops" />
            <div className="text-xs text-muted-foreground">Used as the OpenClaw agent key (folder name).</div>
          </div>
          <div className="space-y-1">
            <Label>Model</Label>
            <ModelSelect value={model} onChange={setModel} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input
              value={identityName}
              onChange={(e) => setIdentityName(e.target.value)}
              placeholder="Agent name"
            />
          </div>
          <div className="space-y-1">
            <Label>Emoji</Label>
            <Input
              value={identityEmoji}
              onChange={(e) => setIdentityEmoji(e.target.value)}
              placeholder="🤖"
            />
          </div>
          <div className="space-y-1">
            <Label>Theme</Label>
            <Input
              value={identityTheme}
              onChange={(e) => setIdentityTheme(e.target.value)}
              placeholder="e.g. Pragmatic"
            />
          </div>
          <div className="md:col-span-3 space-y-1">
            <Label>Description</Label>
            <Textarea
              value={agentDescription}
              onChange={(e) => setAgentDescription(e.target.value)}
              placeholder="What is this agent for?"
              className="min-h-24"
            />
          </div>
          <div className="md:col-span-3 text-xs text-muted-foreground">
            This writes IDENTITY.md and applies it via{" "}
            <span className="font-mono">openclaw agents set-identity</span>.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Core Files (seed)</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label>SOUL.md</Label>
            <Textarea value={soul} onChange={(e) => setSoul(e.target.value)} className="min-h-48" />
          </div>
          <div className="space-y-1">
            <Label>USER.md</Label>
            <Textarea value={user} onChange={(e) => setUser(e.target.value)} className="min-h-48" />
          </div>
          <div className="space-y-1">
            <Label>TOOLS.md</Label>
            <Textarea value={tools} onChange={(e) => setTools(e.target.value)} className="min-h-48" />
          </div>
          <div className="space-y-1">
            <Label>HEARTBEAT.md</Label>
            <Textarea value={heartbeat} onChange={(e) => setHeartbeat(e.target.value)} className="min-h-48" />
          </div>

          <div className="md:col-span-2 flex gap-2">
            <Button
              disabled={!agentId.trim() || !model.trim() || !identityName.trim() || create.isPending}
              onClick={async () => {
                setError(null);
                const identity = `# IDENTITY.md\n\n- **Name:** ${identityName}\n- **Creature:** AI assistant\n- **Vibe:** ${identityTheme}\n- **Emoji:** ${identityEmoji}\n- **Avatar:** *(none yet)*\n`;

                await create.mutateAsync({
                  agentId: agentId.trim(),
                  model: model.trim(),
                  description: agentDescription.trim() || undefined,
                  files: [
                    { path: "IDENTITY.md", content: identity },
                    { path: "SOUL.md", content: soul },
                    { path: "USER.md", content: user },
                    { path: "TOOLS.md", content: tools },
                    { path: "HEARTBEAT.md", content: heartbeat },
                  ],
                });
              }}
            >
              {create.isPending ? "Creating…" : "Create"}
            </Button>
            <Link
              href="/agents"
              className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
            >
              Cancel
            </Link>
          </div>
          <div className="md:col-span-2">
            <Alert>
              Creates an isolated agent on this OpenClaw host and seeds core markdown files in its workspace.
            </Alert>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

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
  soul: string;
  user: string;
};

const PRESETS: Preset[] = [
  {
    key: "ops",
    name: "Ops / Reliability",
    description: "Incident response, runbooks, health checks, automation.",
    model: "anthropic/claude-sonnet-4-20250514",
    soul: "# SOUL\n\nYou are a sharp operations assistant. Be concise, correct, and safety-first.",
    user: "# USER\n\nYou support the team by keeping systems healthy and responding quickly to issues."
  },
  {
    key: "pm",
    name: "Product + Planning",
    description: "Planning, summarizing, tracking decisions, drafting specs.",
    model: "anthropic/claude-sonnet-4-20250514",
    soul: "# SOUL\n\nYou are a pragmatic product assistant. Prefer clarity, action items, and tradeoffs.",
    user: "# USER\n\nYou help plan and execute product work."
  },
  {
    key: "research",
    name: "Research",
    description: "Find sources, synthesize, produce briefings and comparisons.",
    model: "anthropic/claude-sonnet-4-20250514",
    soul: "# SOUL\n\nYou are a careful research assistant. Cite sources and avoid speculation.",
    user: "# USER\n\nYou help by researching and summarizing." 
  }
];

export function NewAgentPage() {
  const [presetKey, setPresetKey] = useState<string>(PRESETS[0].key);
  const preset = useMemo(() => PRESETS.find((p) => p.key === presetKey) ?? PRESETS[0], [presetKey]);

  const [agentId, setAgentId] = useState("");
  const [model, setModel] = useState(preset.model);
  const [soul, setSoul] = useState(preset.soul);
  const [user, setUser] = useState(preset.user);
  const [error, setError] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const create = trpc.agents.createIsolated.useMutation({
    onSuccess: async () => {
      await utils.agents.list.invalidate();
      window.location.href = `/agents/${agentId}`;
    },
    onError: (e) => setError(e.message)
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
          <p className="text-sm text-muted-foreground">Create a new isolated agent with a preset archetype.</p>
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
              setSoul(p.soul);
              setUser(p.user);
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
            <Input value={model} onChange={(e) => setModel(e.target.value)} />
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
          <div className="md:col-span-2 flex gap-2">
            <Button
              disabled={!agentId.trim() || !model.trim() || create.isPending}
              onClick={async () => {
                setError(null);
                await create.mutateAsync({
                  agentId: agentId.trim(),
                  model: model.trim(),
                  files: [
                    { path: "SOUL.md", content: soul },
                    { path: "USER.md", content: user }
                  ]
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
              Note: this creates an isolated agent on the OpenClaw host and seeds SOUL.md + USER.md in its workspace.
            </Alert>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

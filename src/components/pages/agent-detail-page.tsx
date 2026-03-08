"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc-client";

export function AgentDetailPage({ agentId }: { agentId: string }) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const agent = trpc.agents.get.useQuery({ agentId });

  // We'll wire actual file listing/edit next (server-side allowlisted fs access).

  const status = agent.data?.agent?.status ?? "unknown";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/agents" className="text-sm text-muted-foreground hover:text-foreground">
            ← Back
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Agent: {agent.data?.agent?.name ?? agentId}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="font-mono">{agentId}</span>
            <Badge>{status}</Badge>
            {agent.data?.agent?.model ? <span>· {agent.data.agent.model}</span> : null}
          </div>
        </div>
      </div>

      {error ? <Alert className="border-destructive text-destructive">{error}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>Core Files</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="rounded-md border p-4 text-sm text-muted-foreground">
            File editor wiring is next (read/write allowlisted markdown files on the OpenClaw host).
            <div className="mt-2">
              Planned: list files from agent workspace + agent dir, edit + save, and reload.
            </div>
          </div>
          <div className="rounded-md border p-4 text-sm text-muted-foreground">
            Once enabled, you’ll be able to edit SOUL.md / USER.md / TOOLS.md etc just like OpenClaw UI.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

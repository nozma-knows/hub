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
  const utils = trpc.useUtils();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const agent = trpc.agents.get.useQuery({ agentId });
  const files = trpc.agents.filesList.useQuery(
    { agentId },
    {
      enabled: Boolean(agentId)
    }
  );

  const fileRead = trpc.agents.filesRead.useQuery(
    { agentId, path: selectedPath ?? "" },
    {
      enabled: Boolean(selectedPath)
    }
  );

  const save = trpc.agents.filesWrite.useMutation({
    onSuccess: async () => {
      if (selectedPath) {
        await utils.agents.filesRead.invalidate({ agentId, path: selectedPath });
      }
    },
    onError: (e) => setError(e.message)
  });

  const status = agent.data?.agent?.status ?? "unknown";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
          <CardTitle>Files</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <div className="text-sm font-medium">Workspace files</div>
            <div className="mt-2 max-h-[50vh] overflow-auto rounded-md border">
              {(files.data ?? []).map((f) => (
                <button
                  key={f.path}
                  className={`block w-full px-3 py-2 text-left text-sm hover:bg-muted ${
                    selectedPath === f.path ? "bg-muted" : ""
                  }`}
                  onClick={() => {
                    setError(null);
                    setSelectedPath(f.path);
                    setDraft("");
                  }}
                >
                  <div className="truncate font-mono">{f.path}</div>
                  <div className="text-xs text-muted-foreground">
                    {Math.round(f.size / 1024)} KB · {new Date(f.mtimeMs).toLocaleString()}
                  </div>
                </button>
              ))}
              {(files.data ?? []).length === 0 && !files.isLoading ? (
                <div className="p-3 text-sm text-muted-foreground">No files found (or not synced yet).</div>
              ) : null}
            </div>
          </div>

          <div className="lg:col-span-2 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium truncate">{selectedPath ?? "Select a file"}</div>
              <Button
                disabled={!selectedPath || save.isPending}
                onClick={async () => {
                  if (!selectedPath) return;
                  setError(null);
                  const content = draft || fileRead.data?.content || "";
                  await save.mutateAsync({ agentId, path: selectedPath, content });
                }}
              >
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            </div>

            {selectedPath ? (
              <Textarea
                value={draft || fileRead.data?.content || ""}
                onChange={(e) => setDraft(e.target.value)}
                className="min-h-[50vh] font-mono text-xs"
              />
            ) : (
              <div className="rounded-md border p-4 text-sm text-muted-foreground">
                Pick a file on the left to view/edit.
              </div>
            )}

            <div className="text-xs text-muted-foreground">
              Editing is allowlisted to files under ~/.openclaw for safety. Writes are audited.
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc-client";

export function AgentDetailPage({ agentId }: { agentId: string }) {
  const utils = trpc.useUtils();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  const agent = trpc.agents.get.useQuery({ agentId });
  const models = trpc.agents.listValidModels.useQuery();
  const setModel = trpc.agents.setModel.useMutation({
    onError: (e) => setError(e.message),
    onSuccess: async () => {
      await utils.agents.get.invalidate({ agentId });
    }
  });

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

  const remove = trpc.agents.remove.useMutation({
    onSuccess: async () => {
      await utils.agents.list.invalidate();
      window.location.href = "/agents";
    },
    onError: (e) => setError(e.message)
  });

  const me = trpc.auth.me.useQuery();
  const matrix = trpc.permissions.matrix.useQuery();
  const isAdmin = me.data?.workspace?.role === "owner" || me.data?.workspace?.role === "admin";
  const upsert = trpc.permissions.upsert.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.permissions.matrix.invalidate(), utils.audit.list.invalidate()]);
    },
    onError: (e) => setError(e.message)
  });

  const permissionMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const row of matrix.data?.permissions ?? []) {
      map.set(`${row.agentId}:${row.providerId}`, row.isAllowed);
    }
    return map;
  }, [matrix.data]);

  const status = agent.data?.agent?.status ?? "unknown";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/agents" className="text-sm text-muted-foreground hover:text-foreground">
            ← Back
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Agent: {agent.data?.agent?.name ?? agentId}</h1>
          {agent.data?.agent?.description ? (
            <div className="mt-1 text-sm text-muted-foreground">{agent.data.agent.description}</div>
          ) : (
            <div className="mt-1 text-sm text-muted-foreground italic">No description yet.</div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="font-mono">{agentId}</span>
            <Badge>{status}</Badge>
            {agent.data?.agent?.model ? <span>· {agent.data.agent.model}</span> : null}
          </div>
        </div>
      </div>

      {error ? <Alert className="border-destructive text-destructive">{error}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>Model</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground">
            Current: <span className="font-mono">{agent.data?.agent?.model ?? "-"}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              className="rounded-md border bg-background px-3 py-2 text-sm"
              defaultValue={agent.data?.agent?.model ?? ""}
              onChange={(e) => {
                const next = e.target.value;
                if (!next) return;
                setError(null);
                setModel.mutate({ agentId, model: next });
              }}
            >
              <option value="" disabled>
                Select model…
              </option>
              {(models.data ?? []).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <div className="text-xs text-muted-foreground self-center">
              Updates OpenClaw config for this agent.
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Access</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            Agent-owned access controls (per provider). Admins can edit.
          </div>

          <div className="mt-3 space-y-2">
            {(matrix.data?.providers ?? []).map((provider) => {
              const key = `${agentId}:${provider.id}`;
              const enabled = permissionMap.get(key) ?? false;
              return (
                <div
                  key={provider.id}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{provider.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{provider.key}</div>
                  </div>
                  <Switch
                    checked={enabled}
                    disabled={!isAdmin}
                    onChange={(event) => {
                      upsert.mutate({
                        agentId,
                        providerId: provider.id,
                        isAllowed: event.target.checked,
                        scopeOverrides: {}
                      });
                    }}
                  />
                </div>
              );
            })}

            {(matrix.data?.providers ?? []).length === 0 && !matrix.isLoading ? (
              <div className="rounded-md border p-3 text-sm text-muted-foreground">No providers found.</div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Files</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <div className="text-sm font-medium">Workspace files</div>
            {files.error ? (
              <Alert className="mt-2 border-destructive text-destructive">{files.error.message}</Alert>
            ) : null}
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

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>Danger Zone</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground">
            Deleting an agent removes its config and local state. This cannot be undone.
          </div>
          <Button
            variant="destructive"
            onClick={() => {
              setDeleteConfirm("");
              setDeleteOpen(true);
            }}
          >
            Delete Agent
          </Button>
        </CardContent>
      </Card>

      {deleteOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-lg bg-background shadow-lg">
            <div className="border-b p-4">
              <div className="text-lg font-semibold">Delete agent</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Type <span className="font-mono">{agentId}</span> to confirm.
              </div>
            </div>

            <div className="space-y-3 p-4">
              <Input
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder={agentId}
              />
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setDeleteOpen(false);
                    setDeleteConfirm("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={deleteConfirm.trim() !== agentId || remove.isPending}
                  onClick={async () => {
                    setError(null);
                    await remove.mutateAsync({ agentId });
                  }}
                >
                  {remove.isPending ? "Deleting…" : "Delete"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

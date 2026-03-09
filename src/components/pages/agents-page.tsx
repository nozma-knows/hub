"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc-client";

export function AgentsPage() {
  const utils = trpc.useUtils();
  const agents = trpc.agents.list.useQuery();

  const syncMutation = trpc.agents.sync.useMutation({
    onSuccess: async () => {
      await utils.agents.list.invalidate();
    }
  });

  // Auto-sync on page entry if it's been a while. Keeps counts correct without constant polling.
  useEffect(() => {
    const KEY = "hub.agents.lastAutoSyncAt";
    const COOLDOWN_MS = 10 * 60 * 1000;

    const maybeSync = () => {
      if (syncMutation.isPending) return;
      const last = Number(sessionStorage.getItem(KEY) ?? "0");
      if (Date.now() - last < COOLDOWN_MS) return;
      sessionStorage.setItem(KEY, String(Date.now()));
      syncMutation.mutate();
    };

    // On mount + when returning to tab
    maybeSync();

    const onVis = () => {
      if (document.visibilityState === "visible") maybeSync();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Agents</h1>
          <p className="text-sm text-muted-foreground">
            Grid overview. Click an agent for details, files, integrations, and actions.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
            {syncMutation.isPending ? "Syncing…" : "Sync from OpenClaw"}
          </Button>
          <Link
            href="/agents/new"
            className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Create Agent
          </Link>
        </div>
      </div>

      {agents.error ? <Alert className="border-destructive text-destructive">{agents.error.message}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(agents.data ?? []).map((agent) => (
          <Link key={agent.id} href={`/agents/${agent.id}`} className="block">
            <Card className="h-full transition-colors hover:bg-muted/40">
              <CardHeader className="space-y-2">
                <CardTitle className="flex items-start justify-between gap-3 text-base">
                  <span className="min-w-0 truncate">{agent.name}</span>
                  <Badge className="shrink-0">{agent.status}</Badge>
                </CardTitle>
                <div className="text-xs text-muted-foreground truncate font-mono">{agent.id}</div>
              </CardHeader>
              <CardContent className="space-y-1 text-sm text-muted-foreground">
                <div className="truncate">Model: {agent.model ?? agent.openclawVersion ?? "-"}</div>
                <div className="truncate">
                  Last sync: {agent.lastSyncedAt ? new Date(agent.lastSyncedAt).toLocaleString() : "-"}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}

        {(agents.data ?? []).length === 0 && !agents.isLoading ? (
          <Card className="sm:col-span-2 lg:col-span-3">
            <CardContent className="p-6 text-sm text-muted-foreground">
              No agents found. Click “Sync from OpenClaw”.
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc-client";

export function UsagePage() {
  const [agentId, setAgentId] = useState("");
  const [limit, setLimit] = useState("50");

  const usage = trpc.usage.list.useQuery({
    agentId: agentId || undefined,
    limit: Number(limit) || 50,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Usage Logs</h1>
        <p className="text-sm text-muted-foreground">
          Per-invoke token and latency history for this workspace.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <Input
            placeholder="agent id"
            value={agentId}
            onChange={(event) => setAgentId(event.target.value)}
          />
          <Input placeholder="limit" value={limit} onChange={(event) => setLimit(event.target.value)} />
          <Button onClick={() => usage.refetch()}>Refresh</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invocations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(usage.data ?? []).map((row) => (
            <div key={row.id} className="rounded-md border p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{row.agentId}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(row.createdAt).toLocaleString()}
                </div>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                tokens: {row.totalTokens ?? "-"} (prompt {row.promptTokens ?? "-"}, completion{" "}
                {row.completionTokens ?? "-"}){" · "}
                duration: {row.durationMs ?? "-"}ms
                {" · "}
                result: {row.result}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

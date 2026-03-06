"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc-client";

export function AuditPage() {
  const [agentId, setAgentId] = useState("");
  const [providerKey, setProviderKey] = useState("");
  const [limit, setLimit] = useState("50");

  const auditQuery = trpc.audit.list.useQuery({
    limit: Number(limit) || 50,
    agentId: agentId || undefined,
    providerKey: providerKey || undefined
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Audit Log</h1>
        <p className="text-sm text-muted-foreground">Immutable history for connections, permissions, and agent writes.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <Input placeholder="agent id" value={agentId} onChange={(event) => setAgentId(event.target.value)} />
          <Input
            placeholder="provider key"
            value={providerKey}
            onChange={(event) => setProviderKey(event.target.value)}
          />
          <Input placeholder="limit" value={limit} onChange={(event) => setLimit(event.target.value)} />
          <Button onClick={() => auditQuery.refetch()}>Refresh</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(auditQuery.data ?? []).map((event) => (
            <div key={event.id} className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <div className="text-sm font-medium">{event.eventType}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(event.createdAt).toLocaleString()} {event.agentId ? `· ${event.agentId}` : ""}
                </div>
              </div>
              <Badge className={event.result === "success" ? "border-green-600 text-green-700" : "border-destructive text-destructive"}>
                {event.result}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

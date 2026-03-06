"use client";

import { ShieldCheck, Server, Workflow } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc-client";

export function OverviewPage() {
  const agents = trpc.agents.list.useQuery();
  const providers = trpc.providers.list.useQuery();
  const audit = trpc.audit.list.useQuery({ limit: 8 });

  const connectedProviders = providers.data?.filter((provider) => provider.connected).length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Control Plane Overview</h1>
        <p className="text-sm text-muted-foreground">
          Manage OpenClaw agents, provider integrations, and policy-gated access.
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="h-4 w-4" /> Agents
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{agents.data?.length ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" /> Connected Tools
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{connectedProviders}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Workflow className="h-4 w-4" /> Events (latest)
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{audit.data?.length ?? 0}</CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Recent Audit Events</CardTitle>
          <CardDescription>Latest security and mutation events.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(audit.data ?? []).map((event) => (
            <div key={event.id} className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <div className="text-sm font-medium">{event.eventType}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(event.createdAt).toLocaleString()} {event.agentId ? `· ${event.agentId}` : ""}
                </div>
              </div>
              <Badge className={event.result === "success" ? "border-green-600 text-green-700" : "border-red-600 text-red-700"}>
                {event.result}
              </Badge>
            </div>
          ))}
          {audit.data?.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">No events yet.</div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

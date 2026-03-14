"use client";

import { ShieldCheck, Server } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc-client";

export function OverviewPage() {
  const agents = trpc.agents.list.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const providers = trpc.providers.list.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const connectedProviders = providers.data?.filter((provider) => provider.connected).length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Control Plane Overview</h1>
        <p className="text-sm text-muted-foreground">Manage OpenClaw agents and provider integrations.</p>
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="h-4 w-4" /> Agents
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {agents.isLoading ? "…" : (agents.data?.length ?? 0)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" /> Connected Tools
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {providers.isLoading ? "…" : connectedProviders}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

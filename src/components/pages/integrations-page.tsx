"use client";

import { useSearchParams } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc-client";

export function IntegrationsPage() {
  const searchParams = useSearchParams();
  const status = searchParams.get("status");
  const providerParam = searchParams.get("provider");
  const error = searchParams.get("error");

  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const providers = trpc.providers.list.useQuery();
  const isAdmin = me.data?.workspace?.role === "owner" || me.data?.workspace?.role === "admin";

  const connect = trpc.providers.beginConnect.useMutation();
  const disconnect = trpc.providers.disconnect.useMutation({
    onSuccess: async () => {
      await providers.refetch();
      await utils.providers.list.invalidate();
    }
  });

  const health = trpc.providers.health.useMutation();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Integrations</h1>
        <p className="text-sm text-muted-foreground">Connect Slack and Linear through the provider plugin interface.</p>
      </div>

      {status ? (
        <Alert className={status === "connected" ? "border-green-600 text-green-700" : "border-destructive text-destructive"}>
          OAuth status: {status}
          {providerParam ? ` (${providerParam})` : ""}
          {error ? ` - ${error}` : ""}
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {(providers.data ?? []).map((provider) => (
          <Card key={provider.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>{provider.name}</span>
                <Badge className={provider.connected ? "border-green-600 text-green-700" : ""}>
                  {provider.connected ? "Connected" : "Not connected"}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="text-muted-foreground">Scopes: {provider.scopes.join(", ") || "-"}</div>
              <div className="text-muted-foreground">Account: {provider.externalAccountId ?? "-"}</div>
              <div className="flex flex-wrap gap-2">
                {provider.connected ? (
                  <Button
                    variant="outline"
                    disabled={!isAdmin}
                    onClick={() => disconnect.mutate({ providerKey: provider.key as "slack" | "linear" })}
                  >
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    disabled={!isAdmin}
                    onClick={async () => {
                      const result = await connect.mutateAsync({
                        providerKey: provider.key as "slack" | "linear",
                        redirectPath: "/integrations"
                      });
                      window.location.href = result.url;
                    }}
                  >
                    Connect
                  </Button>
                )}
                <Button
                  variant="secondary"
                  disabled={!isAdmin}
                  onClick={() => health.mutate({ providerKey: provider.key as "slack" | "linear" })}
                >
                  Check Health
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {health.data ? (
        <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs">{JSON.stringify(health.data, null, 2)}</pre>
      ) : null}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc-client";

const DEFAULT_SCOPES: Record<string, string> = {
  slack: "channels:read,chat:write,users:read",
  linear: "read,write"
};

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
  const upsertAppCreds = trpc.providers.upsertAppCredentials.useMutation({
    onSuccess: async () => {
      await providers.refetch();
      await utils.providers.list.invalidate();
    }
  });

  const [configuring, setConfiguring] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [scopes, setScopes] = useState("");
  const [configError, setConfigError] = useState<string | null>(null);


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
              <div className="text-muted-foreground">
                App Config: {provider.appConfigured ? "Configured" : "Not configured"}
              </div>
              <div className="text-muted-foreground">Scopes: {provider.scopes.join(", ") || "-"}</div>
              <div className="text-muted-foreground">Account: {provider.externalAccountId ?? "-"}</div>

              {configuring === provider.key ? (
                <div className="space-y-3 rounded-md border p-3">
                  {configError ? <Alert className="border-destructive text-destructive">{configError}</Alert> : null}
                  <div className="space-y-1">
                    <Label>Client ID</Label>
                    <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="..." />
                  </div>
                  <div className="space-y-1">
                    <Label>Client Secret</Label>
                    <Input
                      type="password"
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                      placeholder="..."
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Scopes (comma-separated)</Label>
                    <Input value={scopes} onChange={(e) => setScopes(e.target.value)} placeholder={DEFAULT_SCOPES[provider.key] ?? ""} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={upsertAppCreds.isPending}
                      onClick={async () => {
                        setConfigError(null);
                        try {
                          const scopesArray = (scopes || DEFAULT_SCOPES[provider.key] || "")
                            .split(/[,\s]+/)
                            .map((s) => s.trim())
                            .filter(Boolean);
                          await upsertAppCreds.mutateAsync({
                            providerKey: provider.key as "slack" | "linear",
                            clientId,
                            clientSecret,
                            scopes: scopesArray
                          });
                          setConfiguring(null);
                          setClientId("");
                          setClientSecret("");
                          setScopes("");
                        } catch (err) {
                          setConfigError(err instanceof Error ? err.message : "Failed to save credentials");
                        }
                      }}
                    >
                      Save
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setConfiguring(null);
                        setConfigError(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Credentials are encrypted at rest and only visible to workspace admins.
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {!provider.appConfigured ? (
                  <Button
                    variant="outline"
                    disabled={!isAdmin}
                    onClick={() => {
                      setConfigError(null);
                      setConfiguring(provider.key);
                      setClientId("");
                      setClientSecret("");
                      setScopes(DEFAULT_SCOPES[provider.key] ?? "");
                    }}
                  >
                    Configure
                  </Button>
                ) : null}

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
                    disabled={!isAdmin || !provider.appConfigured}
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

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

  // Clawhub skills
  const [skillQuery, setSkillQuery] = useState("");
  const [selectedSkill, setSelectedSkill] = useState<any | null>(null);
  const [skillConsent, setSkillConsent] = useState(false);
  const skillsSearch = trpc.skills.searchClawhub.useQuery(
    { query: skillQuery.trim(), limit: 10 },
    { enabled: skillQuery.trim().length >= 2 }
  );
  const skillInspect = trpc.skills.inspectClawhub.useQuery(
    { slug: selectedSkill?.id ?? "", version: selectedSkill?.version },
    { enabled: Boolean(selectedSkill?.id) }
  );
  const installs = trpc.skills.listInstalls.useQuery(
    { limit: 50 },
    {
      refetchInterval: (query) => {
        const rows = query.state.data as any[] | undefined;
        const hasPending = (rows ?? []).some((r) => r?.status === "queued" || r?.status === "installing");
        return hasPending ? 2000 : false;
      }
    }
  );
  const install = trpc.skills.installFromClawhub.useMutation({
    onSuccess: async () => {
      await installs.refetch();
      setSelectedSkill(null);
      setSkillConsent(false);
    }
  });

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

      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Skills (Clawhub)</h2>
          <p className="text-sm text-muted-foreground">Search the Clawhub catalog and install skills with explicit consent.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Search</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              value={skillQuery}
              onChange={(e) => setSkillQuery(e.target.value)}
              placeholder="Search skills (type 2+ chars)…"
            />
            {skillsSearch.error ? (
              <Alert className="border-destructive text-destructive">
                {String((skillsSearch.error as any).message ?? skillsSearch.error)}
              </Alert>
            ) : null}

            {skillsSearch.isFetching ? <div className="text-sm text-muted-foreground">Searching…</div> : null}

            <div className="space-y-2">
              {(skillsSearch.data?.results ?? []).map((s: any) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSelectedSkill(s);
                    setSkillConsent(false);
                  }}
                  className="w-full rounded-md border bg-background p-3 text-left hover:bg-muted/40"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-sm font-medium">{s.name}</div>
                    {s.version ? <div className="text-xs text-muted-foreground">v{s.version}</div> : null}
                  </div>
                  {s.description ? <div className="mt-1 text-xs text-muted-foreground line-clamp-2">{s.description}</div> : null}
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    {s.author ? `by ${s.author}` : ""} {s.id ? `· id: ${s.id}` : ""}
                  </div>
                </button>
              ))}
              {skillQuery.trim().length >= 2 && (skillsSearch.data?.results?.length ?? 0) === 0 && !skillsSearch.isFetching ? (
                <div className="text-sm text-muted-foreground">No results.</div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Installed / Recent installs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(installs.data ?? []).map((i: any) => (
              <div key={i.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">{i.name ?? i.clawhubSkillId}</div>
                  <Badge className={i.status === "installed" ? "border-green-600 text-green-700" : i.status === "failed" ? "border-destructive text-destructive" : ""}>
                    {i.status}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {i.version ? `v${i.version}` : ""} {i.author ? `· by ${i.author}` : ""}
                </div>

                {i.statusDetail || typeof i.progress === "number" ? (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {i.statusDetail ? i.statusDetail : null}
                    {typeof i.progress === "number" ? ` · ${i.progress}%` : null}
                  </div>
                ) : null}

                {i.error ? <div className="mt-2 text-xs text-destructive whitespace-pre-wrap">{i.error}</div> : null}

                {i.logs ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground">Logs</summary>
                    <pre className="mt-2 max-h-64 overflow-auto rounded-md border bg-muted p-2 text-[11px]">{i.logs}</pre>
                  </details>
                ) : null}

                {i.status === "failed" ? (
                  <div className="mt-3 flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={install.isPending}
                      onClick={async () => {
                        await install.mutateAsync({
                          clawhubSkillId: i.clawhubSkillId,
                          name: i.name ?? undefined,
                          author: i.author ?? undefined,
                          version: i.version ?? undefined,
                          installSpec: i.installSpec ?? undefined
                        });
                      }}
                    >
                      Retry
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
            {(installs.data ?? []).length === 0 ? <div className="text-sm text-muted-foreground">No installs yet.</div> : null}
          </CardContent>
        </Card>
      </div>

      {selectedSkill ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-xl rounded-xl bg-background shadow-lg overflow-hidden">
            <div className="border-b p-4">
              <div className="text-lg font-semibold">Install skill</div>
              <div className="mt-1 text-sm text-muted-foreground">Confirm you want to install this skill into OpenClaw.</div>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div className="rounded-md border p-3">
                <div className="font-medium">{selectedSkill.name}</div>
                {selectedSkill.description ? <div className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">{selectedSkill.description}</div> : null}
                <div className="mt-2 text-xs text-muted-foreground font-mono">id: {selectedSkill.id}</div>
                {selectedSkill.installSpec ? (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Install spec: <span className="font-mono">{selectedSkill.installSpec}</span>
                  </div>
                ) : null}
              </div>

              <Alert className="border-muted text-muted-foreground">
                This will install code onto the Hub host via the OpenClaw plugin installer. Only proceed if you trust the publisher and install spec.
              </Alert>

              <div className="flex items-start gap-2 rounded-md border p-3">
                <input
                  id="skill-consent"
                  type="checkbox"
                  className="mt-1"
                  checked={skillConsent}
                  onChange={(e) => setSkillConsent(e.target.checked)}
                />
                <Label htmlFor="skill-consent" className="text-sm">
                  I understand this installs third-party code and I approve installing this skill.
                </Label>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedSkill(null);
                    setSkillConsent(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  disabled={install.isPending || !skillConsent}
                  onClick={async () => {
                    await install.mutateAsync({
                      clawhubSkillId: selectedSkill.id,
                      name: selectedSkill.name,
                      author: selectedSkill.author,
                      version: selectedSkill.version,
                      installSpec: selectedSkill.installSpec
                    });
                  }}
                >
                  {install.isPending ? "Queuing…" : "Queue install"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

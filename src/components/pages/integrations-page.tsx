"use client";

import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc-client";

export function IntegrationsPage() {
  // Clawhub skills
  const [skillQuery, setSkillQuery] = useState("");
  const [selectedSkill, setSelectedSkill] = useState<any | null>(null);
  const [skillConsent, setSkillConsent] = useState(false);
  const [skillError, setSkillError] = useState<string | null>(null);

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
    },
    onError: (e) => setSkillError(e.message)
  });

  const retryInstall = trpc.skills.retryInstall.useMutation({
    onSuccess: async () => {
      await installs.refetch();
    },
    onError: (e) => setSkillError(e.message)
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Integrations</h1>
        <p className="text-sm text-muted-foreground">Install skills from Clawhub to add capabilities.</p>
      </div>

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

            {skillsSearch.isFetching ? <div className="text-sm text-muted-foreground">Searching…</div> : null}

            <div className="space-y-2">
              {(skillsSearch.data?.results ?? []).map((s: any) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSkillError(null);
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
                  <div className="mt-2 text-[11px] text-muted-foreground flex flex-wrap gap-x-2 gap-y-1">
                    <span>{s.author ? `by ${s.author}` : ""}</span>
                    {typeof s.stats?.stars === "number" ? <span>★ {s.stats.stars}</span> : null}
                    {typeof s.stats?.downloads === "number" ? <span>{s.stats.downloads.toLocaleString()} downloads</span> : null}
                    {s.id ? <span>· id: {s.id}</span> : null}
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
                  <Badge
                    className={
                      i.status === "installed"
                        ? "border-green-600 text-green-700"
                        : i.status === "failed" || i.status === "rate_limited"
                          ? "border-destructive text-destructive"
                          : ""
                    }
                  >
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

                {i.status === "failed" || i.status === "rate_limited" ? (
                  <div className="mt-3 flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={install.isPending}
                      onClick={async () => {
                        // Re-queue the existing install row (keeps history/logs)
                        setSkillError(null);
                        await retryInstall.mutateAsync({ installId: i.id });
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
              <div className="mt-1 text-sm text-muted-foreground">Explicit consent required before installing code onto the host.</div>
            </div>
            <div className="p-4 space-y-3 text-sm">
              {skillError ? <Alert className="border-destructive text-destructive">{skillError}</Alert> : null}

              <div className="rounded-md border p-3">
                <div className="font-medium">{selectedSkill.name}</div>
                {selectedSkill.description ? (
                  <div className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">{selectedSkill.description}</div>
                ) : null}
                <div className="mt-2 text-xs text-muted-foreground font-mono">slug: {selectedSkill.id}</div>
              </div>

              {skillInspect.isLoading ? (
                <div className="rounded-md border p-3 text-sm text-muted-foreground">Loading details…</div>
              ) : skillInspect.data ? (
                <div className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-muted-foreground">Source</div>
                    <a className="text-xs underline" href={skillInspect.data.sourceUrl} target="_blank" rel="noreferrer">
                      View on Clawhub
                    </a>
                  </div>
                  <div className="text-xs text-muted-foreground">Version: {skillInspect.data.version ?? "latest"}</div>
                  {skillInspect.data.security ? (
                    <div className="text-xs text-muted-foreground">
                      Security: <span className="font-mono">{String(skillInspect.data.security.status ?? "unknown")}</span>
                      {skillInspect.data.security.hasWarnings ? " (warnings)" : ""}
                    </div>
                  ) : null}
                  <div className="text-xs text-muted-foreground">Install command</div>
                  <pre className="max-h-[25vh] overflow-auto rounded-md bg-muted p-2 text-xs">{skillInspect.data.installCmd}</pre>
                  {skillInspect.data.files?.length ? (
                    <div>
                      <div className="text-xs text-muted-foreground">Files</div>
                      <div className="mt-1 max-h-[18vh] overflow-auto rounded-md border bg-background p-2 text-xs font-mono">
                        {skillInspect.data.files.map((f: any) => (
                          <div key={f.path} className="truncate">
                            {f.path} ({Math.round((f.size ?? 0) / 1024)} KB)
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {skillInspect.data.skillMd ? (
                    <details className="rounded-md border">
                      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">Preview SKILL.md</summary>
                      <pre className="max-h-[35vh] overflow-auto p-3 text-xs">{skillInspect.data.skillMd}</pre>
                    </details>
                  ) : null}
                </div>
              ) : skillInspect.error ? (
                <Alert className="border-destructive text-destructive">{skillInspect.error.message}</Alert>
              ) : null}

              <Alert className="border-muted text-muted-foreground">
                Installs into <span className="font-mono">/root/.openclaw/skills</span> (OpenClaw managed skills directory).
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
                    setSkillError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={install.isPending || !skillConsent}
                  onClick={async () => {
                    try {
                      setSkillError(null);
                      await install.mutateAsync({
                        clawhubSkillId: selectedSkill.id,
                        name: skillInspect.data?.name ?? selectedSkill.name,
                        author: skillInspect.data?.owner ?? selectedSkill.author,
                        version: skillInspect.data?.version ?? selectedSkill.version,
                        installSpec: selectedSkill.installSpec
                      });
                      // Close modal immediately on success to avoid confusing UX.
                      setSelectedSkill(null);
                      setSkillConsent(false);
                    } catch (err) {
                      setSkillError(err instanceof Error ? err.message : "Failed to queue install");
                    }
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

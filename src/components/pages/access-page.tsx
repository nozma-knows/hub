"use client";

import { useMemo } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc-client";

export function AccessPage() {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const matrix = trpc.permissions.matrix.useQuery();
  const isAdmin = me.data?.workspace?.role === "owner" || me.data?.workspace?.role === "admin";

  const upsert = trpc.permissions.upsert.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.permissions.matrix.invalidate(), utils.audit.list.invalidate()]);
    }
  });

  const permissionMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const row of matrix.data?.permissions ?? []) {
      map.set(`${row.agentId}:${row.providerId}`, row.isAllowed);
    }
    return map;
  }, [matrix.data]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Access Matrix</h1>
        <p className="text-sm text-muted-foreground">Explicit allow/deny per agent and provider.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tool Permissions</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Mobile: per-agent stacked permissions */}
          <div className="space-y-3 md:hidden">
            {(matrix.data?.agents ?? []).map((agent) => (
              <Card key={agent.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    <div className="font-medium">{agent.name}</div>
                    <div className="text-xs text-muted-foreground">{agent.id}</div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(matrix.data?.providers ?? []).map((provider) => {
                    const permissionKey = `${agent.id}:${provider.id}`;
                    const enabled = permissionMap.get(permissionKey) ?? false;
                    return (
                      <div key={provider.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{provider.name}</div>
                          <div className="truncate text-xs text-muted-foreground">{provider.key}</div>
                        </div>
                        <Switch
                          checked={enabled}
                          disabled={!isAdmin}
                          onChange={(event) => {
                            upsert.mutate({
                              agentId: agent.id,
                              providerId: provider.id,
                              isAllowed: event.target.checked,
                              scopeOverrides: {}
                            });
                          }}
                        />
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Desktop/tablet: matrix table */}
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  {(matrix.data?.providers ?? []).map((provider) => (
                    <TableHead key={provider.id}>{provider.name}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(matrix.data?.agents ?? []).map((agent) => (
                  <TableRow key={agent.id}>
                    <TableCell>
                      <div className="font-medium">{agent.name}</div>
                      <div className="text-xs text-muted-foreground">{agent.id}</div>
                    </TableCell>
                    {(matrix.data?.providers ?? []).map((provider) => {
                      const permissionKey = `${agent.id}:${provider.id}`;
                      const enabled = permissionMap.get(permissionKey) ?? false;
                      return (
                        <TableCell key={provider.id}>
                          <Switch
                            checked={enabled}
                            disabled={!isAdmin}
                            onChange={(event) => {
                              upsert.mutate({
                                agentId: agent.id,
                                providerId: provider.id,
                                isAllowed: event.target.checked,
                                scopeOverrides: {}
                              });
                            }}
                          />
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

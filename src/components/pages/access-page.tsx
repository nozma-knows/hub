"use client";

import { useMemo } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc-client";

export function AccessPage() {
  const utils = trpc.useUtils();
  const matrix = trpc.permissions.matrix.useQuery();

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
        </CardContent>
      </Card>
    </div>
  );
}

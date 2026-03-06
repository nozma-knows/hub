"use client";

import { useEffect, useMemo, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc-client";

const defaultBehavior = {
  model: "gpt-4.1",
  instructions: "You are a reliable operations assistant.",
  runtimeConfig: "{}"
};

export function AgentsPage() {
  const utils = trpc.useUtils();
  const agents = trpc.agents.list.useQuery();

  const syncMutation = trpc.agents.sync.useMutation({
    onSuccess: async () => {
      await utils.agents.list.invalidate();
    },
    onError: (error) => {
      setErrorMessage(error.message);
    }
  });

  const createMutation = trpc.agents.create.useMutation({
    onSuccess: async () => {
      await utils.agents.list.invalidate();
    }
  });

  const updateMutation = trpc.agents.update.useMutation({
    onSuccess: async () => {
      await utils.agents.list.invalidate();
    }
  });

  const deleteMutation = trpc.agents.remove.useMutation({
    onSuccess: async () => {
      await utils.agents.list.invalidate();
    }
  });

  const invokeMutation = trpc.actions.invoke.useMutation();

  const [name, setName] = useState("");
  const [model, setModel] = useState(defaultBehavior.model);
  const [instructions, setInstructions] = useState(defaultBehavior.instructions);
  const [runtimeConfig, setRuntimeConfig] = useState(defaultBehavior.runtimeConfig);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("Run a health check and summarize.");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const parsedRuntime = useMemo(() => {
    try {
      return JSON.parse(runtimeConfig) as Record<string, unknown>;
    } catch {
      return null;
    }
  }, [runtimeConfig]);

  useEffect(() => {
    if (agents.error) {
      setErrorMessage(agents.error.message);
    }
  }, [agents.error]);

  const canSubmit = Boolean(name.trim()) && Boolean(model.trim()) && Boolean(instructions.trim()) && parsedRuntime;

  const resetForm = () => {
    setName("");
    setModel(defaultBehavior.model);
    setInstructions(defaultBehavior.instructions);
    setRuntimeConfig(defaultBehavior.runtimeConfig);
    setEditingAgentId(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Agents</h1>
          <p className="text-sm text-muted-foreground">OpenClaw is source of truth. Writes are sent upstream first.</p>
          <p className="text-xs text-muted-foreground">
            Existing agents are discovered from OpenClaw when the local mirror is empty.
          </p>
        </div>
        <Button onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
          {syncMutation.isPending ? "Syncing..." : "Sync from OpenClaw"}
        </Button>
      </div>

      {errorMessage ? <Alert className="border-destructive text-destructive">{errorMessage}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>{editingAgentId ? "Update Agent" : "Create Agent"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ops Helper" />
            </div>
            <div className="space-y-1">
              <Label>Model</Label>
              <Input value={model} onChange={(event) => setModel(event.target.value)} placeholder="gpt-4.1" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Instructions</Label>
            <Textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Runtime Config JSON</Label>
            <Textarea value={runtimeConfig} onChange={(event) => setRuntimeConfig(event.target.value)} className="font-mono" />
          </div>
          <div className="flex items-center gap-2">
            <Button
              disabled={!canSubmit || createMutation.isPending || updateMutation.isPending}
              onClick={() => {
                setErrorMessage(null);
                if (!parsedRuntime) {
                  setErrorMessage("Runtime config must be valid JSON.");
                  return;
                }

                if (editingAgentId) {
                  updateMutation
                    .mutateAsync({
                      agentId: editingAgentId,
                      name,
                      behavior: {
                        model,
                        instructions,
                        runtimeConfig: parsedRuntime
                      }
                    })
                    .then(() => resetForm())
                    .catch((error) => setErrorMessage(error.message));
                  return;
                }

                createMutation
                  .mutateAsync({
                    name,
                    behavior: {
                      model,
                      instructions,
                      runtimeConfig: parsedRuntime
                    }
                  })
                  .then(() => resetForm())
                  .catch((error) => setErrorMessage(error.message));
              }}
            >
              {editingAgentId ? "Update Agent" : "Create Agent"}
            </Button>
            {editingAgentId ? (
              <Button variant="ghost" onClick={resetForm}>
                Cancel
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agent Registry</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Last Sync</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(agents.data ?? []).map((agent) => (
                <TableRow key={agent.id}>
                  <TableCell>
                    <div className="font-medium">{agent.name}</div>
                    <div className="text-xs text-muted-foreground">{agent.id}</div>
                  </TableCell>
                  <TableCell>
                    <Badge>{agent.status}</Badge>
                  </TableCell>
                  <TableCell>{agent.openclawVersion ?? "-"}</TableCell>
                  <TableCell>{agent.lastSyncedAt ? new Date(agent.lastSyncedAt).toLocaleString() : "-"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingAgentId(agent.id);
                          setName(agent.name);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          invokeMutation.mutate({
                            agentId: agent.id,
                            prompt
                          })
                        }
                      >
                        Test Invoke
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => deleteMutation.mutate({ agentId: agent.id })}
                        disabled={deleteMutation.isPending}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agent Action Test</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          {invokeMutation.data ? (
            <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs">
              {JSON.stringify(invokeMutation.data, null, 2)}
            </pre>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

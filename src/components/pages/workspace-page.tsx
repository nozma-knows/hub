"use client";

import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc-client";

export function WorkspacePage() {
  const utils = trpc.useUtils();
  const members = trpc.members.list.useQuery();
  const me = trpc.auth.me.useQuery();
  const modelCredentials = trpc.modelCredentials.list.useQuery();

  const invite = trpc.members.invite.useMutation({
    onSuccess: async () => {
      await members.refetch();
      await utils.members.list.invalidate();
    }
  });
  const updateRole = trpc.members.updateRole.useMutation({
    onSuccess: async () => {
      await members.refetch();
    }
  });
  const remove = trpc.members.remove.useMutation({
    onSuccess: async () => {
      await members.refetch();
    }
  });
  const upsertModelCredential = trpc.modelCredentials.upsert.useMutation({
    onSuccess: async () => {
      await modelCredentials.refetch();
      setApiKey("");
    }
  });
  const removeModelCredential = trpc.modelCredentials.remove.useMutation({
    onSuccess: async () => {
      await modelCredentials.refetch();
    }
  });

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "operator">("operator");
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelProvider, setModelProvider] = useState<"openai" | "anthropic">("openai");
  const [apiKey, setApiKey] = useState("");

  const isAdmin = me.data?.workspace?.role === "owner" || me.data?.workspace?.role === "admin";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Workspace</h1>
        <p className="text-sm text-muted-foreground">
          Invite collaborators and manage roles for this shared control plane.
        </p>
      </div>

      {!isAdmin ? (
        <Alert className="border-amber-600 text-amber-700">
          Only owner/admin can manage invites and membership changes.
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Invite Member</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label>Email</Label>
              <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="friend@example.com" />
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={role}
                onChange={(event) => setRole(event.target.value as "admin" | "operator")}
              >
                <option value="operator">Operator</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="flex items-end">
              <Button
                disabled={!isAdmin || invite.isPending || !email.trim()}
                onClick={async () => {
                  setError(null);
                  try {
                    const result = await invite.mutateAsync({
                      email,
                      role
                    });
                    setInviteToken(result.token);
                    setEmail("");
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Invite failed");
                  }
                }}
              >
                Send Invite
              </Button>
            </div>
          </div>
          {error ? <Alert className="border-destructive text-destructive">{error}</Alert> : null}
          {inviteToken ? (
            <Alert>
              Invite token (share privately): <code>{inviteToken}</code>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(members.data?.members ?? []).map((member) => (
            <div
              key={`${member.workspaceId}:${member.userId}`}
              className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{member.userId}</div>
                <div className="text-xs text-muted-foreground">
                  Joined {new Date(member.joinedAt).toLocaleString()}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{member.role}</Badge>
                {isAdmin ? (
                  <>
                    <select
                      className="w-full rounded-md border bg-background px-2 py-2 text-sm sm:w-auto"
                      value={member.role}
                      onChange={(event) =>
                        updateRole.mutate({
                          userId: member.userId,
                          role: event.target.value as "owner" | "admin" | "operator"
                        })
                      }
                    >
                      <option value="owner">Owner</option>
                      <option value="admin">Admin</option>
                      <option value="operator">Operator</option>
                    </select>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="w-full sm:w-auto"
                      onClick={() => remove.mutate({ userId: member.userId })}
                    >
                      Remove
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Model Credentials</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <select
              className="rounded-md border bg-background px-3 py-2 text-sm"
              value={modelProvider}
              onChange={(event) => setModelProvider(event.target.value as "openai" | "anthropic")}
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
            <Input
              placeholder="API key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <Button
              disabled={!isAdmin || !apiKey.trim() || upsertModelCredential.isPending}
              onClick={() =>
                upsertModelCredential.mutate({
                  providerKey: modelProvider,
                  apiKey
                })
              }
            >
              Save Credential
            </Button>
          </div>
          {(modelCredentials.data ?? []).map((credential) => (
            <div key={credential.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
              <div>
                {credential.providerKey} · {credential.label}
              </div>
              {isAdmin ? (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() =>
                    removeModelCredential.mutate({
                      providerKey: credential.providerKey as "openai" | "anthropic",
                      label: credential.label
                    })
                  }
                >
                  Remove
                </Button>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

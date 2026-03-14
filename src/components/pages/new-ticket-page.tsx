"use client";

import { useState } from "react";

import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc-client";

export function NewTicketPage() {
  const utils = trpc.useUtils();
  const agents = trpc.agents.list.useQuery();

  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ownerAgentId, setOwnerAgentId] = useState<string>("");

  const create = trpc.tickets.create.useMutation({
    onSuccess: async () => {
      await utils.tickets.list.invalidate();
      window.location.href = "/tickets";
    },
    onError: (e) => setError(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">New ticket</h1>
          <p className="text-sm text-muted-foreground">Create a Hub-native ticket.</p>
        </div>
        <Button type="button" variant="outline" onClick={() => (window.location.href = "/tickets")}>
          Back to tickets
        </Button>
      </div>

      {error ? <Alert className="border-destructive text-destructive">{error}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1 md:col-span-2">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" />
          </div>

          <div className="space-y-1 md:col-span-2">
            <Label>Owner (agent)</Label>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={ownerAgentId}
              onChange={(e) => setOwnerAgentId(e.target.value)}
            >
              <option value="">(Default: Command)</option>
              {(agents.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.id})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1 md:col-span-2">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-32"
            />
          </div>

          <div className="md:col-span-2 flex gap-2">
            <Button
              disabled={!title.trim() || create.isPending}
              onClick={() => {
                setError(null);
                create.mutate({
                  title: title.trim(),
                  description: description.trim() || undefined,
                  ownerAgentId: ownerAgentId || undefined,
                });
              }}
            >
              {create.isPending ? "Creating…" : "Create ticket"}
            </Button>
            <Button type="button" variant="outline" onClick={() => (window.location.href = "/tickets")}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

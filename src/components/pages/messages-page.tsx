"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc-client";

export function MessagesPage() {
  const utils = trpc.useUtils();

  const channels = trpc.messages.channelsList.useQuery();
  const agents = trpc.agents.list.useQuery();

  const [error, setError] = useState<string | null>(null);

  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [channelName, setChannelName] = useState("");
  const [channelDescription, setChannelDescription] = useState("");
  const [channelAgentIds, setChannelAgentIds] = useState<string[]>([]);

  const createChannel = trpc.messages.channelCreate.useMutation({
    onSuccess: async (created) => {
      await utils.messages.channelsList.invalidate();
      setChannelName("");
      setChannelDescription("");
      setChannelAgentIds([]);
      setShowCreateChannel(false);
      window.location.href = `/messages/${created.id}`;
    },
    onError: (e) => setError(e.message)
  });

  const list = useMemo(() => channels.data ?? [], [channels.data]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Messages</h1>
          <p className="text-sm text-muted-foreground">Pick a channel, then view the timeline and send messages.</p>
        </div>
        <Button variant="outline" onClick={() => setShowCreateChannel(true)}>
          New channel
        </Button>
      </div>

      {error ? <Alert className="border-destructive text-destructive">{error}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>Channels</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {list.map((c) => (
            <Link
              key={c.id}
              href={`/messages/${c.id}`}
              className="block rounded-md px-3 py-3 hover:bg-muted"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">#{c.name}</span>
                {c.name === "general" ? <Badge className="bg-muted text-muted-foreground">default</Badge> : null}
              </div>
              {c.description ? <div className="mt-0.5 text-xs text-muted-foreground truncate">{c.description}</div> : null}
            </Link>
          ))}
        </CardContent>
      </Card>

      {showCreateChannel ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-xl rounded-lg bg-background shadow-lg">
            <div className="border-b p-4">
              <div className="text-lg font-semibold">Create channel</div>
              <div className="mt-1 text-sm text-muted-foreground">Create a Hub-native channel and (optionally) assign agents.</div>
            </div>
            <div className="space-y-3 p-4">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={channelName} onChange={(e) => setChannelName(e.target.value)} placeholder="e.g. ops" />
                <div className="text-xs text-muted-foreground">Lowercase, numbers, hyphens only.</div>
              </div>
              <div className="space-y-1">
                <Label>Description</Label>
                <Input value={channelDescription} onChange={(e) => setChannelDescription(e.target.value)} placeholder="What is this channel for?" />
              </div>
              <div className="space-y-2">
                <Label>Agents in channel</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(agents.data ?? []).map((a) => {
                    const checked = channelAgentIds.includes(a.id);
                    return (
                      <label key={a.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setChannelAgentIds((prev) => (checked ? prev.filter((x) => x !== a.id) : [...prev, a.id]));
                          }}
                        />
                        <span className="truncate">{a.name}</span>
                        <span className="text-xs text-muted-foreground font-mono">{a.id}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowCreateChannel(false)}>
                  Cancel
                </Button>
                <Button
                  disabled={!channelName.trim() || createChannel.isPending}
                  onClick={() => {
                    setError(null);
                    createChannel.mutate({
                      name: channelName.trim(),
                      description: channelDescription.trim() || undefined,
                      agentIds: channelAgentIds
                    });
                  }}
                >
                  {createChannel.isPending ? "Creating…" : "Create"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc-client";

export function MessagesPage() {
  const utils = trpc.useUtils();

  const channels = trpc.messages.channelsList.useQuery();
  const agents = trpc.agents.list.useQuery();

  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedChannelId && channels.data && channels.data.length > 0) {
      setSelectedChannelId(channels.data[0].id);
    }
  }, [channels.data, selectedChannelId]);

  const threads = trpc.messages.threadsList.useQuery(
    { channelId: selectedChannelId ?? "" },
    { enabled: Boolean(selectedChannelId) }
  );

  useEffect(() => {
    if (!selectedThreadId && threads.data && threads.data.length > 0) {
      setSelectedThreadId(threads.data[0].id);
    }
  }, [threads.data, selectedThreadId]);

  const thread = trpc.messages.threadGet.useQuery(
    { threadId: selectedThreadId ?? "" },
    { enabled: Boolean(selectedThreadId) }
  );

  const send = trpc.messages.messageSend.useMutation({
    onSuccess: async () => {
      if (selectedThreadId) {
        await utils.messages.threadGet.invalidate({ threadId: selectedThreadId });
        await utils.messages.threadsList.invalidate({ channelId: selectedChannelId! });
      }
    },
    onError: (e) => setError(e.message)
  });

  const createThread = trpc.messages.threadCreate.useMutation({
    onSuccess: async (res) => {
      await utils.messages.threadsList.invalidate({ channelId: selectedChannelId! });
      setSelectedThreadId(res.threadId);
      setNewThreadTitle("");
      setNewThreadBody("");
    },
    onError: (e) => setError(e.message)
  });

  const createChannel = trpc.messages.channelCreate.useMutation({
    onSuccess: async (created) => {
      await utils.messages.channelsList.invalidate();
      setSelectedChannelId(created.id);
      setChannelName("");
      setChannelDescription("");
      setChannelAgentIds([]);
      setShowCreateChannel(false);
    },
    onError: (e) => setError(e.message)
  });

  const [composer, setComposer] = useState("");

  const [newThreadTitle, setNewThreadTitle] = useState("");
  const [newThreadBody, setNewThreadBody] = useState("");

  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [channelName, setChannelName] = useState("");
  const [channelDescription, setChannelDescription] = useState("");
  const [channelAgentIds, setChannelAgentIds] = useState<string[]>([]);

  const selectedChannel = useMemo(
    () => (channels.data ?? []).find((c) => c.id === selectedChannelId) ?? null,
    [channels.data, selectedChannelId]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Messages</h1>
          <p className="text-sm text-muted-foreground">Hub-native channels, threads, and messages.</p>
        </div>
        <Button variant="outline" onClick={() => setShowCreateChannel(true)}>
          New channel
        </Button>
      </div>

      {error ? <Alert className="border-destructive text-destructive">{error}</Alert> : null}

      <div className="grid gap-4 lg:grid-cols-12">
        {/* Channels */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Channels</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {(channels.data ?? []).map((c) => (
              <button
                key={c.id}
                className={`w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted ${
                  selectedChannelId === c.id ? "bg-muted" : ""
                }`}
                onClick={() => {
                  setSelectedChannelId(c.id);
                  setSelectedThreadId(null);
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">#{c.name}</span>
                  {c.name === "general" ? <Badge className="bg-muted text-muted-foreground">default</Badge> : null}
                </div>
                {c.description ? <div className="text-xs text-muted-foreground truncate">{c.description}</div> : null}
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Threads */}
        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle>Threads {selectedChannel ? <span className="text-muted-foreground">· #{selectedChannel.name}</span> : null}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2 rounded-md border p-3">
              <div className="text-sm font-medium">New thread</div>
              <Input value={newThreadTitle} onChange={(e) => setNewThreadTitle(e.target.value)} placeholder="Title (optional)" />
              <Textarea value={newThreadBody} onChange={(e) => setNewThreadBody(e.target.value)} placeholder="Message" className="min-h-24" />
              <Button
                disabled={!selectedChannelId || createThread.isPending || !newThreadBody.trim()}
                onClick={() => {
                  setError(null);
                  createThread.mutate({
                    channelId: selectedChannelId!,
                    title: newThreadTitle.trim() || undefined,
                    body: newThreadBody.trim()
                  });
                }}
              >
                {createThread.isPending ? "Creating…" : "Create"}
              </Button>
            </div>

            <div className="max-h-[55vh] overflow-auto rounded-md border">
              {(threads.data ?? []).map((t) => (
                <button
                  key={t.id}
                  className={`block w-full border-b px-3 py-2 text-left text-sm hover:bg-muted ${
                    selectedThreadId === t.id ? "bg-muted" : ""
                  }`}
                  onClick={() => setSelectedThreadId(t.id)}
                >
                  <div className="truncate font-medium">{t.title || "(no title)"}</div>
                  <div className="text-xs text-muted-foreground">{new Date(t.lastMessageAt).toLocaleString()}</div>
                </button>
              ))}
              {(threads.data ?? []).length === 0 && !threads.isLoading ? (
                <div className="p-3 text-sm text-muted-foreground">No threads yet.</div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {/* Thread view */}
        <Card className="lg:col-span-5">
          <CardHeader>
            <CardTitle>Thread</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!selectedThreadId ? (
              <div className="text-sm text-muted-foreground">Select a thread.</div>
            ) : thread.error ? (
              <Alert className="border-destructive text-destructive">{thread.error.message}</Alert>
            ) : (
              <>
                <div className="rounded-md border p-3">
                  <div className="text-sm font-medium truncate">{thread.data?.thread.title || "(no title)"}</div>
                  <div className="text-xs text-muted-foreground">Status: {thread.data?.thread.status}</div>
                </div>

                <div className="max-h-[55vh] overflow-auto space-y-2 rounded-md border p-3">
                  {(thread.data?.messages ?? []).map((m) => (
                    <div key={m.id} className="rounded-md border bg-background p-2">
                      <div className="text-xs text-muted-foreground">
                        {m.authorType} · {new Date(m.createdAt).toLocaleString()}
                      </div>
                      <div className="whitespace-pre-wrap text-sm">{m.body}</div>
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  <Textarea
                    value={composer}
                    onChange={(e) => setComposer(e.target.value)}
                    placeholder="Reply…"
                    className="min-h-24"
                  />
                  <Button
                    disabled={send.isPending || !composer.trim()}
                    onClick={async () => {
                      if (!selectedThreadId) return;
                      setError(null);
                      await send.mutateAsync({ threadId: selectedThreadId, body: composer.trim() });
                      setComposer("");
                    }}
                  >
                    {send.isPending ? "Sending…" : "Send"}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

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
                            setChannelAgentIds((prev) =>
                              checked ? prev.filter((x) => x !== a.id) : [...prev, a.id]
                            );
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
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowCreateChannel(false);
                  }}
                >
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

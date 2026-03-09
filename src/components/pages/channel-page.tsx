"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc-client";

export function ChannelPage({ channelId }: { channelId: string }) {
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);
  const [composer, setComposer] = useState("");

  const agents = trpc.agents.list.useQuery();
  const [showTicket, setShowTicket] = useState(false);
  const [ticketTitle, setTicketTitle] = useState("");
  const [ticketOwner, setTicketOwner] = useState<string>("");

  const channels = trpc.messages.channelsList.useQuery();
  const channel = useMemo(() => (channels.data ?? []).find((c) => c.id === channelId) ?? null, [channels.data, channelId]);

  const threads = trpc.messages.threadsList.useQuery({ channelId }, { enabled: Boolean(channelId) });

  // Slack-like for now: use the most recent thread in the channel; if none, create one.
  const threadId = threads.data?.[0]?.id ?? null;

  const createThread = trpc.messages.threadCreate.useMutation({
    onSuccess: async (res) => {
      await utils.messages.threadsList.invalidate({ channelId });
      await utils.messages.threadGet.invalidate({ threadId: res.threadId });
    },
    onError: (e) => setError(e.message)
  });

  useEffect(() => {
    if (threads.isFetched && (threads.data?.length ?? 0) === 0 && !createThread.isPending) {
      createThread.mutate({ channelId, title: undefined, body: "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads.isFetched, channelId]);

  const thread = trpc.messages.threadGet.useQuery(
    { threadId: threadId ?? "" },
    { enabled: Boolean(threadId), refetchInterval: 1500 }
  );

  const send = trpc.messages.messageSend.useMutation({
    onSuccess: async () => {
      if (threadId) {
        await utils.messages.threadGet.invalidate({ threadId });
        await utils.messages.threadsList.invalidate({ channelId });
      }
      setComposer("");
    },
    onError: (e) => setError(e.message)
  });

  const createTicket = trpc.tickets.createFromThread.useMutation({
    onSuccess: () => {
      setShowTicket(false);
      setTicketTitle("");
      setTicketOwner("");
    },
    onError: (e) => setError(e.message)
  });

  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [thread.data?.messages?.length]);

  const title = channel ? `#${channel.name}` : "Channel";

  return (
    <div className="space-y-4">
      {error ? <Alert className="border-destructive text-destructive">{error}</Alert> : null}

      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="min-w-0">
            <CardTitle className="truncate">{title}</CardTitle>
            {channel?.description ? (
              <div className="mt-1 text-xs text-muted-foreground truncate">{channel.description}</div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!threadId}
              onClick={() => {
                setError(null);
                setTicketTitle(channel ? `Follow up: #${channel.name}` : "Follow up");
                setShowTicket(true);
              }}
            >
              Create ticket
            </Button>
            <Link href="/messages" className="text-sm text-muted-foreground hover:text-foreground">
              ← Channels
            </Link>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="flex h-[70vh] flex-col">
            <div ref={listRef} className="flex-1 overflow-auto p-3 space-y-2 bg-muted/10">
              {(thread.data?.messages ?? []).filter((m) => m.body.trim().length > 0).map((m) => (
                <div key={m.id} className="rounded-md border bg-background p-2">
                  <div className="text-[11px] text-muted-foreground">
                    {m.authorType} · {new Date(m.createdAt).toLocaleString()}
                  </div>
                  <div className="whitespace-pre-wrap text-sm">{m.body}</div>
                </div>
              ))}
              {(thread.data?.messages ?? []).filter((m) => m.body.trim().length > 0).length === 0 && thread.isFetched ? (
                <div className="p-3 text-sm text-muted-foreground">No messages yet.</div>
              ) : null}
            </div>

            <div className="border-t bg-background p-3">
              <div className="space-y-2">
                <Textarea
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  placeholder="Message…"
                  className="min-h-16"
                />
                <div className="flex justify-end">
                  <Button
                    disabled={!threadId || send.isPending || !composer.trim()}
                    onClick={async () => {
                      if (!threadId) return;
                      setError(null);
                      await send.mutateAsync({ threadId, body: composer.trim() });
                    }}
                  >
                    {send.isPending ? "Sending…" : "Send"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {showTicket ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-xl rounded-lg bg-background shadow-lg">
            <div className="border-b p-4">
              <div className="text-lg font-semibold">Create ticket</div>
              <div className="mt-1 text-sm text-muted-foreground">This will create a Todo ticket linked to this channel’s thread.</div>
            </div>
            <div className="space-y-3 p-4">
              <div className="space-y-1">
                <Label>Title</Label>
                <Input value={ticketTitle} onChange={(e) => setTicketTitle(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Owner (agent)</Label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={ticketOwner}
                  onChange={(e) => setTicketOwner(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {(agents.data ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.id})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowTicket(false)}>
                  Cancel
                </Button>
                <Button
                  disabled={!threadId || !ticketTitle.trim() || createTicket.isPending}
                  onClick={async () => {
                    if (!threadId) return;
                    setError(null);
                    await createTicket.mutateAsync({
                      threadId,
                      title: ticketTitle.trim(),
                      description: `Created from channel ${title}.`,
                      ownerAgentId: ticketOwner || undefined
                    });
                  }}
                >
                  {createTicket.isPending ? "Creating…" : "Create"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

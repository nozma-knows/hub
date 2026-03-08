"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc-client";

export function ChannelPage({ channelId }: { channelId: string }) {
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);
  const [composer, setComposer] = useState("");

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
    { enabled: Boolean(threadId) }
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
          <Link href="/messages" className="text-sm text-muted-foreground hover:text-foreground">
            ← Channels
          </Link>
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
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
  const [keyboardInsetPx, setKeyboardInsetPx] = useState(0);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);

  const composerRef = useRef<HTMLTextAreaElement | null>(null);

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

  function updateMentionQuery(nextText: string) {
    const el = composerRef.current;
    const cursor = el ? el.selectionStart ?? nextText.length : nextText.length;
    const before = nextText.slice(0, cursor);
    const match = before.match(/(^|\s)@([a-zA-Z0-9_-]*)$/);
    if (!match) {
      setMentionQuery(null);
      return;
    }
    // Only expose @command for now.
    const q = (match[2] ?? "").toLowerCase();
    setMentionQuery(q);
  }

  function insertMention(value: string) {
    const el = composerRef.current;
    if (!el) {
      setComposer((prev) => `${prev}${value} `);
      setMentionQuery(null);
      return;
    }

    const text = el.value;
    const cursor = el.selectionStart ?? text.length;
    const before = text.slice(0, cursor);
    const after = text.slice(cursor);

    const match = before.match(/(^|\s)@([a-zA-Z0-9_-]*)$/);
    if (!match) return;

    const prefixLen = before.length - match[0].length;
    const replaced = `${before.slice(0, prefixLen)}${match[1] ?? ""}${value} `;
    const next = replaced + after;

    setComposer(next);
    setMentionQuery(null);

    // Restore cursor just after inserted mention
    window.setTimeout(() => {
      try {
        el.focus();
        const pos = replaced.length;
        el.setSelectionRange(pos, pos);
      } catch {
        // ignore
      }
    }, 0);
  }

  useEffect(() => {
    // Hard-lock scrolling at the document level (iOS Safari will otherwise scroll the page)
    // and keep the page stable when the on-screen keyboard opens/closes.
    const html = document.documentElement;
    const body = document.body;

    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevHtmlOverscroll = (html.style as any).overscrollBehavior;
    const prevBodyOverscroll = (body.style as any).overscrollBehavior;

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    (html.style as any).overscrollBehavior = "none";
    (body.style as any).overscrollBehavior = "none";

    const vv = (window as any).visualViewport as VisualViewport | undefined;
    const onVV = () => {
      // Prevent iOS from shifting/zooming the whole page when keyboard appears.
      if (typeof window.scrollTo === "function") window.scrollTo(0, 0);

      // Keep the composer visible above the keyboard.
      // iOS reports the shrunken visual viewport; the difference is the keyboard height.
      if (vv) {
        const inset = Math.max(0, Math.round(window.innerHeight - (vv.height + vv.offsetTop)));
        setKeyboardInsetPx(inset);
      }
    };

    // initialize once
    onVV();

    vv?.addEventListener?.("resize", onVV);
    vv?.addEventListener?.("scroll", onVV);

    return () => {
      vv?.removeEventListener?.("resize", onVV);
      vv?.removeEventListener?.("scroll", onVV);
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      (html.style as any).overscrollBehavior = prevHtmlOverscroll;
      (body.style as any).overscrollBehavior = prevBodyOverscroll;
    };
  }, []);

  return (
    <div
      className="fixed inset-x-0 bottom-0 top-14 mx-auto w-full max-w-7xl px-2 py-2 sm:px-6 overflow-hidden"
      style={{ paddingBottom: `calc(env(safe-area-inset-bottom) + ${keyboardInsetPx}px)` }}
    >
      {error ? <Alert className="mb-4 border-destructive text-destructive">{error}</Alert> : null}

      <Card className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border bg-background/80 shadow-sm backdrop-blur">
        <CardHeader className="shrink-0 flex flex-row items-center justify-between space-y-0">
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

        <CardContent className="flex-1 min-h-0 p-0">
          <div className="flex h-full min-h-0 flex-col">
            <div ref={listRef} className="flex-1 min-h-0 overflow-auto overscroll-contain px-3 py-4 space-y-2 bg-muted/10">
              {(thread.data?.messages ?? []).filter((m) => m.body.trim().length > 0).map((m) => {
                const isAgent = m.authorType === "agent";
                return (
                  <div key={m.id} className={isAgent ? "flex justify-start" : "flex justify-end"}>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(m.body);
                          setCopiedMessageId(m.id);
                          window.setTimeout(() => {
                            setCopiedMessageId((cur) => (cur === m.id ? null : cur));
                          }, 800);
                        } catch {
                          // ignore
                        }
                      }}
                      className={
                        "max-w-[85%] rounded-2xl px-3 py-2 text-left text-sm shadow-sm active:opacity-80 " +
                        (isAgent
                          ? "bg-background border"
                          : "bg-primary text-primary-foreground")
                      }
                    >
                      <div className="mb-1 flex items-center justify-between gap-2 text-[10px] opacity-70">
                        <span>
                          {isAgent ? "command" : "you"} · {new Date(m.createdAt).toLocaleTimeString()}
                        </span>
                        {copiedMessageId === m.id ? <span className="font-medium">Copied</span> : null}
                      </div>
                      <div className="whitespace-pre-wrap break-words overflow-hidden">{m.body}</div>
                    </button>
                  </div>
                );
              })}
              {(thread.data?.messages ?? []).filter((m) => m.body.trim().length > 0).length === 0 && thread.isFetched ? (
                <div className="p-3 text-sm text-muted-foreground">No messages yet.</div>
              ) : null}
            </div>

            <div className="shrink-0 border-t bg-background/80 backdrop-blur p-3">
              <div className="space-y-2">
                <Textarea
                  ref={composerRef}
                  value={composer}
                  onChange={(e) => {
                    const next = e.target.value;
                    setComposer(next);
                    updateMentionQuery(next);
                  }}
                  onKeyDown={(e) => {
                    if (!mentionQuery) return;
                    if (e.key === "Escape") {
                      setMentionQuery(null);
                      return;
                    }
                    if (e.key === "Tab" || e.key === "Enter") {
                      // If user is typing @c..., accept autocomplete.
                      if ("command".startsWith(mentionQuery)) {
                        e.preventDefault();
                        insertMention("@command");
                      }
                    }
                  }}
                  placeholder="Message…"
                  className="min-h-14 rounded-xl text-base"
                  inputMode="text"
                  autoCorrect="on"
                  autoCapitalize="sentences"
                />

                {mentionQuery !== null ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => insertMention("@command")}
                      className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs hover:bg-muted"
                    >
                      <Badge className="bg-primary text-primary-foreground">@</Badge>
                      <span className="font-medium">command</span>
                      <span className="text-muted-foreground">(tap to insert)</span>
                    </button>
                  </div>
                ) : null}

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

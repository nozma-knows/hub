"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Mic } from "lucide-react";

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: any) => void) | null;
  onerror: ((ev: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MarkdownMessage } from "@/components/markdown";
import { Textarea } from "@/components/ui/textarea";
import { isSendShortcut } from "@/lib/keyboard";
import {
  acquireStream,
  getMicPermissionState,
  release as releaseMic,
  stop as stopMic,
} from "@/lib/mic-manager";
import { trpc } from "@/lib/trpc-client";

export function ChannelPage({ channelId }: { channelId: string }) {
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const [keyboardInsetPx, setKeyboardInsetPx] = useState(0);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [copyToast, setCopyToast] = useState<null | { text: string; at: number }>(null);
  const [messageMenu, setMessageMenu] = useState<null | { id: string; body: string }>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);

  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [sttError, setSttError] = useState<string | null>(null);
  const [recordSeconds, setRecordSeconds] = useState(0);

  // Streaming dictation buffer (we append partial transcript while recording)
  const [dictationText, setDictationText] = useState("");
  const dictationTextRef = useRef("");
  const [composerBase, setComposerBase] = useState<string | null>(null);
  const sttQueueRef = useRef(Promise.resolve());
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordChunksRef = useRef<BlobPart[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const recordStartPendingRef = useRef(false);

  const speechRecRef = useRef<SpeechRecognitionLike | null>(null);
  const usingSpeechApiRef = useRef(false);

  async function stopRecordingAndSend() {
    // If using browser speech API, stop it.
    if (usingSpeechApiRef.current && speechRecRef.current) {
      try {
        speechRecRef.current.stop();
      } catch {
        // ignore
      }
      return;
    }

    const mr = mediaRecorderRef.current;
    if (!mr) return;

    if (mr.state !== "inactive") mr.stop();
  }

  function normalizeTranscript(text: string) {
    return text
      .replace(/\b(at\s*command|@\s*command)\b/gi, "@command")
      .replace(/\s+/g, " ")
      .trim();
  }

  async function transcribeBlob(blob: Blob): Promise<string> {
    const form = new FormData();
    form.append(
      "file",
      blob,
      `recording.${blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm"}`
    );
    const resp = await fetch("/api/stt/transcribe", { method: "POST", body: form });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(txt || "Transcription failed");
    }
    const data = (await resp.json()) as { text?: string };
    return normalizeTranscript((data.text ?? "").toString());
  }

  async function startRecording() {
    if (isRecording || isTranscribing) return;
    if (recordStartPendingRef.current) return;

    recordStartPendingRef.current = true;
    setSttError(null);

    // Prefer free, browser-native streaming speech API when available.
    try {
      const w = window as any;
      const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
      if (Ctor) {
        const rec: SpeechRecognitionLike = new Ctor();
        usingSpeechApiRef.current = true;
        speechRecRef.current = rec;

        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = "en-US";

        setIsRecording(true);
        setRecordSeconds(0);
        setDictationText("");
        // Snapshot the *actual* current textarea value (state can lag on mobile)
        // so we never "lose" what you typed right before tapping the mic.
        setComposerBase(composerRef.current?.value ?? composer);
        recordTimerRef.current = window.setInterval(() => setRecordSeconds((s) => s + 1), 1000);

        rec.onresult = (ev: any) => {
          try {
            let interim = "";
            let finalText = "";
            for (let i = ev.resultIndex; i < ev.results.length; i++) {
              const r = ev.results[i];
              const t = String(r[0]?.transcript ?? "");
              if (r.isFinal) finalText += t;
              else interim += t;
            }
            const merged = normalizeTranscript(`${finalText} ${interim}`);
            dictationTextRef.current = merged;
            setDictationText(merged);
          } catch {
            // ignore
          }
        };

        rec.onerror = (ev: any) => {
          const msg = String(ev?.error || ev?.message || "speech_error");
          setSttError(msg);
          setIsRecording(false);
          if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
          recordTimerRef.current = null;
          usingSpeechApiRef.current = false;
          speechRecRef.current = null;
        };

        rec.onend = () => {
          // onend fires after stop() too.
          setIsRecording(false);
          if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
          recordTimerRef.current = null;

          // Use ref (not state) to avoid losing the last onresult due to React state timing.
          const fullText = (dictationTextRef.current || "").trim();
          if (fullText) {
            setComposer((prev) => {
              const base = (prev ?? "").trim();
              return base ? `${base} ${fullText}` : fullText;
            });
            setSttError(null);
          } else {
            setSttError("No speech detected");
          }

          dictationTextRef.current = "";
          setDictationText("");
          setComposerBase(null);
          usingSpeechApiRef.current = false;
          speechRecRef.current = null;
        };

        rec.start();

        // if we got here, we're done.
        return;
      }
    } catch {
      // fall through to Whisper
    }

    // Fallback to Whisper recording/transcribe when SpeechRecognition isn't available.
    if (!window.isSecureContext) {
      setSttError("Microphone requires HTTPS (secure context)");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setSttError("Microphone not supported in this browser");
      return;
    }

    try {
      const perm = await getMicPermissionState();
      if (perm === "denied") {
        setSttError("Microphone permission denied. Enable it in browser settings and reload.");
        return;
      }

      const stream = await acquireStream();
      mediaStreamRef.current = stream;

      const types = [
        "audio/mp4",
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/ogg",
      ];
      const mimeType = types.find((t) => (window as any).MediaRecorder?.isTypeSupported?.(t)) ?? "";

      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = mr;
      recordChunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (!e.data || e.data.size === 0) return;
        recordChunksRef.current.push(e.data);
        if (mr.state === "recording") {
          const chunk = e.data;
          sttQueueRef.current = sttQueueRef.current
            .then(async () => {
              try {
                setIsTranscribing(true);
                const partial = await transcribeBlob(chunk);
                if (!partial) return;
                setDictationText((prev) => {
                  const base = prev.trim();
                  const next = base ? `${base} ${partial}` : partial;
                  dictationTextRef.current = next;
                  return next;
                });
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                setSttError(msg);
              } finally {
                setIsTranscribing(false);
              }
            })
            .catch(() => {});
        }
      };

      mr.onstop = async () => {
        try {
          setIsRecording(false);
          setRecordSeconds(0);
          if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
          recordTimerRef.current = null;

          // Release mic ASAP for privacy, but keep permission/stream reusable.
          releaseMic();
          mediaStreamRef.current = null;

          await sttQueueRef.current.catch(() => {});

          let fullText = dictationText.trim();
          if (fullText.length < 2) {
            const blob = new Blob(recordChunksRef.current, { type: mr.mimeType || "audio/webm" });
            recordChunksRef.current = [];
            setIsTranscribing(true);
            try {
              fullText = await transcribeBlob(blob);
            } catch (e) {
              setSttError(e instanceof Error ? e.message : String(e));
              return;
            } finally {
              setIsTranscribing(false);
            }
          }

          if (!fullText) {
            setSttError("No speech detected");
            return;
          }

          setComposer((prev) => {
            const base = (prev ?? "").trim();
            return base ? `${base} ${fullText}` : fullText;
          });

          setDictationText("");
          setComposerBase(null);

          window.setTimeout(() => {
            try {
              composerRef.current?.focus();
              const el = composerRef.current;
              if (el) {
                const pos = el.value.length;
                el.setSelectionRange(pos, pos);
              }
            } catch {
              // ignore
            }
          }, 0);
        } catch (e) {
          setSttError(e instanceof Error ? e.message : String(e));
        } finally {
          setIsTranscribing(false);
        }
      };

      setIsRecording(true);
      setRecordSeconds(0);
      setDictationText("");
      // Snapshot the *actual* current textarea value (state can lag on mobile)
      setComposerBase(composerRef.current?.value ?? composer);
      recordTimerRef.current = window.setInterval(() => setRecordSeconds((s) => s + 1), 1000);
      mr.start(2000);
    } catch (err) {
      const e = err as any;
      const name = typeof e?.name === "string" ? e.name : "Error";
      const msg = typeof e?.message === "string" ? e.message : String(err);
      const text = `${name}: ${msg}`;
      setSttError(text);
      if (String(name).toLowerCase().includes("notallowed")) {
        // likely permission denied / blocked
      }
      stopMic();
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;
    } finally {
      recordStartPendingRef.current = false;
    }
  }

  const agents = trpc.agents.list.useQuery();
  const [showTicket, setShowTicket] = useState(false);
  const [ticketTitle, setTicketTitle] = useState("");
  const [ticketOwner, setTicketOwner] = useState<string>("");

  const channels = trpc.messages.channelsList.useQuery();
  const channel = useMemo(
    () => (channels.data ?? []).find((c) => c.id === channelId) ?? null,
    [channels.data, channelId]
  );

  const threads = trpc.messages.threadsList.useQuery({ channelId }, { enabled: Boolean(channelId) });

  // Slack-like for now: use the most recent thread in the channel; if none, create one.
  const threadId = threads.data?.[0]?.id ?? null;

  const createThread = trpc.messages.threadCreate.useMutation({
    onSuccess: async (res) => {
      await utils.messages.threadsList.invalidate({ channelId });
      await utils.messages.threadGet.invalidate({ threadId: res.threadId });
    },
    onError: (e) => setError(e.message),
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

  const [pendingAttachments, setPendingAttachments] = useState<any[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [lightbox, setLightbox] = useState<{ url: string; name?: string } | null>(null);
  const [dragActive, setDragActive] = useState(false);

  async function uploadImages(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setError(null);

    for (const f of list) {
      if (!f.type.startsWith("image/")) {
        setError("Only images are supported.");
        continue;
      }
      setUploadingCount((n) => n + 1);
      try {
        const form = new FormData();
        form.append("file", f, f.name);
        const resp = await fetch("/api/media/upload", { method: "POST", body: form });
        const json = await resp.json();
        if (!resp.ok) {
          setError(json?.error ? String(json.error) : "Upload failed");
          continue;
        }
        setPendingAttachments((prev) => [...prev, json]);
      } catch (e: any) {
        setError(e?.message ?? String(e));
      } finally {
        setUploadingCount((n) => Math.max(0, n - 1));
      }
    }
  }

  const send = trpc.messages.messageSend.useMutation({
    onSuccess: async () => {
      if (threadId) {
        await utils.messages.threadGet.invalidate({ threadId });
        await utils.messages.threadsList.invalidate({ channelId });
      }
      setComposer("");
      setPendingAttachments([]);
    },
    onError: (e) => setError(e.message),
  });

  const createTicket = trpc.tickets.createFromThread.useMutation({
    onSuccess: () => {
      setShowTicket(false);
      setTicketTitle("");
      setTicketOwner("");
    },
    onError: (e) => setError(e.message),
  });

  const listRef = useRef<HTMLDivElement | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [unseenCount, setUnseenCount] = useState(0);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      const atBottom = dist < 120;
      setIsAtBottom(atBottom);
      if (atBottom) setUnseenCount(0);
    };

    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    if (isAtBottom) {
      el.scrollTop = el.scrollHeight;
      return;
    }

    // User is reading older messages; show a lightweight unread indicator.
    setUnseenCount((n) => n + 1);
  }, [thread.data?.messages?.length, isAtBottom]);

  const title = channel ? `#${channel.name}` : "Channel";

  function updateMentionQuery(nextText: string) {
    const el = composerRef.current;
    const cursor = el ? (el.selectionStart ?? nextText.length) : nextText.length;
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

      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
      try {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive")
          mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
      stopMic();
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;
    };
  }, []);

  return (
    <div
      className="h-full min-h-0 mx-auto w-full max-w-7xl px-2 py-2 sm:px-6 overflow-hidden"
      style={{ paddingBottom: `calc(env(safe-area-inset-bottom) + ${keyboardInsetPx}px)` }}
    >
      {error ? <Alert className="mb-4 border-destructive text-destructive">{error}</Alert> : null}

      <Card className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border bg-background/80 shadow-sm backdrop-blur">
        {messageMenu ? (
          <div
            className="fixed inset-0 z-[70] bg-black/40"
            onClick={() => setMessageMenu(null)}
            aria-hidden="true"
          />
        ) : null}

        {messageMenu ? (
          <div className="fixed inset-x-0 bottom-0 z-[80] mx-auto w-full max-w-2xl px-2 pb-2">
            <div className="rounded-2xl border bg-background shadow-lg">
              <div className="border-b px-4 py-3 text-sm font-medium">Message</div>
              <div className="flex flex-col gap-2 p-3">
                {(() => {
                  // If the message contains a ticket deep-link, show "Go to ticket".
                  const m = messageMenu.body.match(/\/tickets\?open=([0-9a-fA-F-]{36})/);
                  const ticketId = m?.[1];
                  if (!ticketId) return null;
                  return (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setMessageMenu(null);
                        window.location.href = `/tickets?open=${ticketId}`;
                      }}
                    >
                      Go to ticket
                    </Button>
                  );
                })()}

                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(messageMenu.body);
                      setCopiedMessageId(messageMenu.id);
                      setCopyToast({ text: "Copied", at: Date.now() });
                      window.setTimeout(() => {
                        setCopiedMessageId((cur) => (cur === messageMenu.id ? null : cur));
                        setCopyToast((cur) => (cur && Date.now() - cur.at > 700 ? null : cur));
                      }, 800);
                    } catch {
                      // ignore
                    } finally {
                      setMessageMenu(null);
                    }
                  }}
                >
                  Copy
                </Button>

                <Button
                  variant="outline"
                  onClick={() => {
                    // Quick "ask about" flow: prefill composer with @command
                    setComposer((prev) => {
                      const snippet = messageMenu.body.trim().slice(0, 800);
                      const prefix = `@command What do you think about this?\n\n`;
                      return prev.trim() ? `${prev}\n\n${prefix}${snippet}` : `${prefix}${snippet}`;
                    });
                    setMessageMenu(null);
                    window.setTimeout(() => composerRef.current?.focus(), 0);
                  }}
                >
                  Ask @command about this
                </Button>

                <Button
                  variant="outline"
                  onClick={() => {
                    setTicketTitle(`Follow up: #${channel?.name ?? "channel"}`);
                    setShowTicket(true);
                    setMessageMenu(null);
                  }}
                >
                  Create ticket…
                </Button>

                <Button variant="outline" onClick={() => setMessageMenu(null)}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        ) : null}
        {copyToast ? (
          <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
            <div className="rounded-full bg-foreground/90 px-4 py-2 text-sm text-background shadow-lg">
              {copyToast.text}
            </div>
          </div>
        ) : null}
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
            <Link href="/messages" className="text-sm text-muted-foreground hover:text-foreground md:hidden">
              ← Channels
            </Link>
          </div>
        </CardHeader>

        <CardContent className="flex-1 min-h-0 p-0">
          <div className="flex h-full min-h-0 flex-col">
            <div
              ref={listRef}
              className="flex-1 min-h-0 overflow-auto overscroll-contain px-3 py-3 bg-muted/10"
            >
              {!isAtBottom && unseenCount > 0 ? (
                <div className="sticky top-2 z-10 flex justify-center">
                  <button
                    type="button"
                    className="rounded-full border bg-background/90 px-3 py-1 text-xs shadow-sm"
                    onClick={() => {
                      const el = listRef.current;
                      if (!el) return;
                      el.scrollTop = el.scrollHeight;
                      setUnseenCount(0);
                    }}
                  >
                    {unseenCount} new message{unseenCount === 1 ? "" : "s"} · Jump to latest
                  </button>
                </div>
              ) : null}

              {(() => {
                const msgs = (thread.data?.messages ?? []).filter((m) => m.body.trim().length > 0);

                if (msgs.length === 0 && thread.isFetched) {
                  return <div className="p-3 text-sm text-muted-foreground">No messages yet.</div>;
                }

                return msgs.map((m: any, idx: number) => {
                  const prev = idx > 0 ? msgs[idx - 1] : null;

                  const sameAuthor =
                    prev &&
                    prev.authorType === m.authorType &&
                    (prev.authorUserId ?? null) === (m.authorUserId ?? null) &&
                    (prev.authorAgentId ?? null) === (m.authorAgentId ?? null);

                  const withinWindow =
                    prev &&
                    Math.abs(new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime()) <
                      5 * 60_000;

                  const grouped = Boolean(sameAuthor && withinWindow && m.authorType !== "system");

                  const isAgent = m.authorType === "agent";
                  const isSystem = m.authorType === "system";
                  const label = isAgent
                    ? m.authorAgentId === "cos"
                      ? "command"
                      : m.authorAgentId || "agent"
                    : isSystem
                      ? "system"
                      : "you";

                  const mine = m.authorType === "human";

                  const bubbleClass =
                    "group relative max-w-[min(720px,90%)] rounded-2xl px-3 py-2 text-left text-sm shadow-sm overflow-hidden" +
                    (isSystem
                      ? " bg-muted/40 border"
                      : isAgent
                        ? " bg-background border"
                        : " bg-primary text-primary-foreground");

                  const align = isSystem
                    ? "flex justify-center"
                    : isAgent
                      ? "flex justify-start"
                      : "flex justify-end";

                  return (
                    <div key={m.id} className={align + (grouped ? " mt-1" : " mt-3")}>
                      <div
                        role="button"
                        tabIndex={0}
                        className={bubbleClass}
                        onClick={() => {
                          setMessageMenu({ id: m.id, body: m.body });
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setMessageMenu({ id: m.id, body: m.body });
                        }}
                      >
                        {!grouped ? (
                          <div className="mb-1 flex items-center justify-between gap-2 text-[11px] opacity-70">
                            <span>
                              {label} · {new Date(m.createdAt).toLocaleTimeString()}
                            </span>
                            <div className="hidden items-center gap-2 group-hover:flex">
                              <button
                                type="button"
                                className={
                                  "rounded-md border px-2 py-0.5 text-[10px] " +
                                  (mine ? "bg-white/10" : "bg-background")
                                }
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void navigator.clipboard?.writeText?.(m.body ?? "");
                                }}
                              >
                                Copy
                              </button>
                            </div>
                          </div>
                        ) : null}

                        {(m.attachments?.length ?? 0) > 0 ? (
                          <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {m.attachments.map((a: any) => (
                              <button
                                key={a.id}
                                type="button"
                                className="group relative overflow-hidden rounded-lg border bg-muted"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setLightbox({ url: a.url, name: a.originalName ?? undefined });
                                }}
                                title={a.originalName ?? "image"}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={a.url}
                                  alt={a.originalName ?? "image"}
                                  className="h-32 w-full object-cover"
                                />
                              </button>
                            ))}
                          </div>
                        ) : null}

                        <div className="break-words leading-relaxed">
                          <MarkdownMessage body={m.body} />
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            <div className="shrink-0 border-t bg-background/80 backdrop-blur p-3">
              <div
                className="relative space-y-2"
                onDragEnter={(e) => {
                  // Only show the drop affordance for file drags.
                  const types = Array.from(e.dataTransfer?.types ?? []);
                  if (types.includes("Files")) setDragActive(true);
                }}
                onDragLeave={(e) => {
                  // If leaving the composer container, clear the state.
                  if (e.currentTarget === e.target) setDragActive(false);
                }}
                onDragOver={(e) => {
                  const types = Array.from(e.dataTransfer?.types ?? []);
                  if (!types.includes("Files")) return;
                  e.preventDefault();
                }}
                onDrop={(e) => {
                  if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return;
                  e.preventDefault();
                  setDragActive(false);
                  void uploadImages(e.dataTransfer.files);
                }}
              >
                {dragActive ? (
                  <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-xl border-2 border-dashed border-primary bg-background/80 text-sm font-medium">
                    Drop images to upload
                  </div>
                ) : null}

                <div className="flex items-stretch gap-2">
                  <div className="flex-1 min-w-0">
                    <Textarea
                      ref={composerRef}
                      value={
                        composerBase !== null
                          ? `${composerBase}${dictationText ? (composerBase.trim() ? " " : "") + dictationText : ""}`
                          : composer
                      }
                      onChange={(e) => {
                        const next = e.target.value;
                        setComposer(next);
                        setComposerBase(null);
                        setDictationText("");
                        updateMentionQuery(next);
                      }}
                      onKeyDown={async (e) => {
                        // Send shortcut: Cmd+Enter (macOS) / Ctrl+Enter (Win/Linux)
                        if (isSendShortcut(e)) {
                          e.preventDefault();
                          if (!threadId) return;
                          if (!composer.trim() || send.isPending) return;
                          setError(null);
                          await send.mutateAsync({
                            threadId,
                            body: composer.trim() || "(image)",
                            attachmentIds: pendingAttachments.map((a) => a.id),
                          });
                          return;
                        }

                        // Mention autocomplete UX
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
                      onPaste={(e) => {
                        const items = Array.from(e.clipboardData?.files ?? []);
                        if (items.length > 0) {
                          void uploadImages(items);
                        }
                      }}
                      placeholder={
                        isRecording
                          ? "Recording…"
                          : isTranscribing
                            ? "Transcribing…"
                            : pendingAttachments.length > 0
                              ? `Message… (+${pendingAttachments.length} image${pendingAttachments.length === 1 ? "" : "s"})`
                              : "Message…"
                      }
                      className="min-h-[104px] rounded-xl text-base"
                      inputMode="text"
                      autoCorrect="on"
                      autoCapitalize="sentences"
                      disabled={isRecording || isTranscribing}
                    />

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        const files = e.target.files;
                        if (files && files.length > 0) void uploadImages(files);
                        e.target.value = "";
                      }}
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex h-12 w-12 items-center justify-center rounded-xl border bg-background shadow-sm transition hover:bg-muted"
                      aria-label="Attach image"
                      title="Attach image"
                    >
                      <span className="text-base">＋</span>
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (isRecording) {
                          await stopRecordingAndSend();
                        } else {
                          await startRecording();
                        }
                      }}
                      className={
                        "inline-flex h-12 w-12 items-center justify-center rounded-xl border shadow-sm transition select-none " +
                        (isRecording
                          ? "bg-destructive text-destructive-foreground"
                          : isTranscribing
                            ? "bg-muted text-muted-foreground"
                            : "bg-background hover:bg-muted")
                      }
                      aria-label={isRecording ? "Stop recording" : "Start recording"}
                      title={isRecording ? "Stop recording" : "Start recording"}
                    >
                      <Mic className="h-5 w-5" />
                    </button>

                    <Button
                      disabled={
                        !threadId ||
                        send.isPending ||
                        (!composer.trim() && pendingAttachments.length === 0) ||
                        uploadingCount > 0
                      }
                      onClick={async () => {
                        if (!threadId) return;
                        setError(null);
                        await send.mutateAsync({
                          threadId,
                          body: composer.trim() || "(image)",
                          attachmentIds: pendingAttachments.map((a) => a.id),
                        });
                      }}
                      className="h-12 w-12 rounded-xl p-0"
                      aria-label="Send"
                      title="Send"
                    >
                      <span className="text-base font-semibold">→</span>
                    </Button>
                  </div>
                </div>

                {isRecording ? (
                  <div className="text-xs text-muted-foreground">
                    Recording… {Math.floor(recordSeconds / 60)}:{String(recordSeconds % 60).padStart(2, "0")}
                  </div>
                ) : isTranscribing ? (
                  <div className="text-xs text-muted-foreground">Transcribing…</div>
                ) : sttError ? (
                  <div className="text-xs text-destructive">
                    STT failed: {sttError}
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Tip: In Chrome iOS: tap the address bar “…” → Site settings → Microphone → Allow, then
                      reload.
                    </div>
                  </div>
                ) : null}

                {pendingAttachments.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {pendingAttachments.map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs"
                      >
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate max-w-[180px] hover:underline"
                        >
                          {a.originalName ?? "image"}
                        </a>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => setPendingAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                          aria-label="Remove attachment"
                          title="Remove"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    {uploadingCount > 0 ? (
                      <div className="text-xs text-muted-foreground">Uploading…</div>
                    ) : null}
                  </div>
                ) : uploadingCount > 0 ? (
                  <div className="text-xs text-muted-foreground">Uploading…</div>
                ) : null}

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

                {lightbox ? (
                  <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
                    role="dialog"
                    aria-modal="true"
                    onClick={() => setLightbox(null)}
                  >
                    <div className="max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={lightbox.url}
                        alt={lightbox.name ?? "image"}
                        className="max-h-[90vh] max-w-[90vw] rounded-lg"
                      />
                      <div className="mt-2 flex justify-end gap-2">
                        <a
                          className="rounded-md bg-background/90 px-3 py-1 text-xs"
                          href={lightbox.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open
                        </a>
                        <button
                          className="rounded-md bg-background/90 px-3 py-1 text-xs"
                          type="button"
                          onClick={() => setLightbox(null)}
                        >
                          Close
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
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
              <div className="mt-1 text-sm text-muted-foreground">
                This will create a Todo ticket linked to this channel’s thread.
              </div>
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
                      ownerAgentId: ticketOwner || undefined,
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

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Hash, MessageCircle, Plus, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc-client";

type ChannelRow = any;

export function MessagesSidebar({ activeChannelId }: { activeChannelId?: string }) {
  const channels = trpc.messages.channelsList.useQuery(undefined, {
    staleTime: 60_000,
    gcTime: 15 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });

  const ensureDm = trpc.messages.channelDmCommandEnsure.useMutation();

  const [q, setQ] = useState("");

  const list = useMemo(() => channels.data ?? [], [channels.data]);
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return list;
    return list.filter((c: ChannelRow) => {
      const name = String(c?.name ?? "").toLowerCase();
      const desc = String(c?.description ?? "").toLowerCase();
      return name.includes(query) || desc.includes(query);
    });
  }, [list, q]);

  const dms = filtered.filter((c: ChannelRow) => c?.kind === "dm");
  const chans = filtered.filter((c: ChannelRow) => c?.kind !== "dm");

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden border-r bg-background">
      <div className="shrink-0 p-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="pl-8" />
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 h-9 w-9 p-0"
            title="Direct message Command"
            onClick={async () => {
              const res = await ensureDm.mutateAsync();
              window.location.href = `/messages/${res.channelId}`;
            }}
          >
            <MessageCircle className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-2">
        <div className="space-y-4">
          <div>
            <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">DIRECT MESSAGES</div>
            <div className="space-y-1">
              {/* MVP: only show Command DM label nicely */}
              {dms.map((c: ChannelRow) => {
                const isActive = c.id === activeChannelId;
                const label = c.dmTargetAgentId === "cos" ? "Direct: Command" : c.name;
                return (
                  <Link
                    key={c.id}
                    href={`/messages/${c.id}`}
                    className={
                      "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted " +
                      (isActive ? "bg-muted" : "")
                    }
                  >
                    <MessageCircle className="h-4 w-4 text-muted-foreground" />
                    <span className="truncate">{label}</span>
                  </Link>
                );
              })}
              {dms.length === 0 ? (
                <div className="px-2 py-1 text-xs text-muted-foreground">No DMs</div>
              ) : null}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between px-2 py-1">
              <div className="text-[11px] font-medium text-muted-foreground">CHANNELS</div>
              <Link
                href="/messages"
                className="text-[11px] text-muted-foreground hover:text-foreground"
                title="Manage channels"
              >
                <Plus className="h-4 w-4" />
              </Link>
            </div>
            <div className="space-y-1">
              {chans.map((c: ChannelRow) => {
                const isActive = c.id === activeChannelId;
                return (
                  <Link
                    key={c.id}
                    href={`/messages/${c.id}`}
                    className={
                      "flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted " +
                      (isActive ? "bg-muted" : "")
                    }
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <Hash className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="truncate">{c.name}</span>
                      {c.name === "general" ? (
                        <Badge className="bg-muted text-muted-foreground">default</Badge>
                      ) : null}
                    </div>
                  </Link>
                );
              })}
              {channels.isLoading && chans.length === 0 ? (
                <div className="space-y-2 px-2 py-2">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="h-5 w-32 animate-pulse rounded bg-muted" />
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

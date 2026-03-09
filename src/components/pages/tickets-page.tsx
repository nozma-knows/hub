"use client";

import { useMemo, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc-client";

type Status = "backlog" | "todo" | "in_progress" | "done" | "canceled";

type AnyStatus = Status | "doing"; // legacy

function normalizeStatus(status: string | null | undefined): Status {
  if (status === "doing") return "in_progress";
  if (status === "backlog" || status === "todo" || status === "in_progress" || status === "done" || status === "canceled") {
    return status;
  }
  return "todo";
}

const columns: Array<{ key: Status; title: string }> = [
  { key: "backlog", title: "Backlog" },
  { key: "todo", title: "Todo" },
  { key: "in_progress", title: "In Progress" },
  { key: "done", title: "Done" },
  { key: "canceled", title: "Canceled" }
];

export function TicketsPage() {
  const utils = trpc.useUtils();
  const tickets = trpc.tickets.list.useQuery();
  const health = trpc.tickets.health.useQuery(undefined, { refetchInterval: 15_000 });

  const move = trpc.tickets.move.useMutation({
    onSuccess: async (_data, vars) => {
      await utils.tickets.list.invalidate();
      if (vars?.ticketId) await utils.tickets.get.invalidate({ ticketId: vars.ticketId });
    },
    onError: (e) => setError(e.message)
  });

  const [error, setError] = useState<string | null>(null);

  const [openTicketId, setOpenTicketId] = useState<string | null>(null);
  const ticketDetail = trpc.tickets.get.useQuery(
    { ticketId: openTicketId ?? "" },
    { enabled: Boolean(openTicketId) }
  );
  const addComment = trpc.tickets.commentAdd.useMutation({
    onSuccess: async () => {
      if (openTicketId) await utils.tickets.get.invalidate({ ticketId: openTicketId });
      setComment("");
    },
    onError: (e) => setError(e.message)
  });
  const invokeOwner = trpc.tickets.invokeOwner.useMutation({
    onSuccess: async () => {
      if (openTicketId) await utils.tickets.get.invalidate({ ticketId: openTicketId });
    },
    onError: (e) => setError(e.message)
  });

  const [comment, setComment] = useState("");

  const grouped = useMemo(() => {
    const map: Record<Status, any[]> = { backlog: [], todo: [], in_progress: [], done: [], canceled: [] };
    for (const t of tickets.data ?? []) {
      const key = normalizeStatus(t.status as AnyStatus);
      map[key].push(t);
    }
    return map;
  }, [tickets.data]);

  return (
    <>
      <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Tickets</h1>
          <p className="text-sm text-muted-foreground">Kanban board aligned with Linear workflow states.</p>
        </div>
        <Button type="button" onClick={() => (window.location.href = "/tickets/new")}>
          New ticket
        </Button>
      </div>

      {error ? <Alert className="border-destructive text-destructive">{error}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>Health</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Dispatcher last tick</div>
            <div className="text-sm">
              {health.data?.dispatcher?.lastTickAt ? new Date(health.data.dispatcher.lastTickAt).toLocaleString() : "(unknown)"}
            </div>
            {health.data?.dispatcher?.lastError ? (
              <div className="text-xs text-destructive line-clamp-2">Last error: {health.data.dispatcher.lastError}</div>
            ) : (
              <div className="text-xs text-muted-foreground">No dispatcher error reported</div>
            )}
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Active runs</div>
            <div className="flex items-center gap-2">
              <Badge className="bg-muted text-muted-foreground">running: {health.data?.tickets.running ?? 0}</Badge>
              <Badge className="bg-muted text-muted-foreground">error: {health.data?.tickets.error ?? 0}</Badge>
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Counts</div>
            <div className="flex flex-wrap gap-2">
              {columns.map((c) => (
                <Badge key={c.key} className="bg-muted text-muted-foreground">
                  {c.title}: {health.data?.tickets.byStatus?.[c.key] ?? 0}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-5">
        {columns.map((col) => (
          <div key={col.key} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">{col.title}</div>
              <Badge className="bg-muted text-muted-foreground">{grouped[col.key].length}</Badge>
            </div>

            <div
              className="min-h-[40vh] rounded-md border bg-muted/10 p-2"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const ticketId = e.dataTransfer.getData("text/ticketId");
                if (!ticketId) return;
                setError(null);
                move.mutate({ ticketId, status: col.key });
              }}
            >
              <div className="space-y-2">
                {grouped[col.key].map((t) => (
                  <button
                    key={t.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/ticketId", t.id);
                    }}
                    onClick={() => setOpenTicketId(t.id)}
                    className="w-full rounded-md border bg-background p-3 text-left shadow-sm hover:bg-muted/40"
                  >
                    <div className="text-sm font-medium">{t.title}</div>
                    {t.ownerAgentId ? (
                      <div className="mt-1 text-xs text-muted-foreground">Owner: {t.ownerAgentId}</div>
                    ) : (
                      <div className="mt-1 text-xs text-muted-foreground">Unassigned</div>
                    )}
                    {t.description ? (
                      <div className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
                        {t.description}
                      </div>
                    ) : null}
                    <div className="mt-2 text-[11px] text-muted-foreground">Updated: {new Date(t.updatedAt).toLocaleString()}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>

      {openTicketId ? (
      <div className="fixed inset-0 z-50 bg-black/50 p-2 sm:p-4">
        <div className="mx-auto flex h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-background shadow-lg">
          <div className="flex items-start justify-between gap-3 border-b p-4 shrink-0">
            <div className="min-w-0 flex-1">
              <div className="text-lg font-semibold truncate">{ticketDetail.data?.ticket.title ?? "Ticket"}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <div className="text-xs text-muted-foreground">State</div>
                <select
                  className="rounded-md border bg-background px-2 py-1 text-xs"
                  value={normalizeStatus(ticketDetail.data?.ticket.status)}
                  onChange={(e) => {
                    if (!openTicketId) return;
                    setError(null);
                    move.mutate({ ticketId: openTicketId, status: e.target.value as Status });
                  }}
                  disabled={move.isPending || ticketDetail.isLoading}
                >
                  {columns.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.title}
                    </option>
                  ))}
                </select>
                {move.isPending ? <span className="text-xs text-muted-foreground">Saving…</span> : null}
              </div>
            </div>
            <Button variant="outline" onClick={() => setOpenTicketId(null)}>
              Close
            </Button>
          </div>

          <div className="flex-1 min-h-0 overflow-auto space-y-4 p-4">
            {ticketDetail.error ? (
              <Alert className="border-destructive text-destructive">{ticketDetail.error.message}</Alert>
            ) : null}

            <div className="rounded-md border p-3 text-sm">
              <div className="text-xs text-muted-foreground">Description</div>
              <div className="mt-1 whitespace-pre-wrap">{ticketDetail.data?.ticket.description ?? "(none)"}</div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-muted-foreground">
                Owner: <span className="font-mono">{ticketDetail.data?.ticket.ownerAgentId ?? "(unassigned)"}</span>
              </div>
              <Button
                disabled={!ticketDetail.data?.ticket.ownerAgentId || invokeOwner.isPending}
                onClick={async () => {
                  setError(null);
                  await invokeOwner.mutateAsync({ ticketId: openTicketId });
                }}
              >
                {invokeOwner.isPending ? "Running…" : "Run owner agent"}
              </Button>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Comments</div>
              <div className="space-y-2 rounded-md border p-3">
                {(ticketDetail.data?.comments ?? []).map((c) => (
                  <div key={c.id} className="rounded-md border bg-background p-2">
                    <div className="text-[11px] text-muted-foreground">
                      {c.authorType} · {new Date(c.createdAt).toLocaleString()}
                    </div>
                    <div className="whitespace-pre-wrap text-sm">{c.body}</div>
                  </div>
                ))}
                {(ticketDetail.data?.comments ?? []).length === 0 ? (
                  <div className="text-sm text-muted-foreground">No comments yet.</div>
                ) : null}
              </div>

              <div className="sticky bottom-0 -mx-4 mt-2 border-t bg-background/90 backdrop-blur px-4 py-3">
                <Textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Add a comment…"
                  className="min-h-14 rounded-xl text-base"
                  inputMode="text"
                  autoCorrect="on"
                  autoCapitalize="sentences"
                />
                <div className="mt-2 flex justify-end">
                  <Button
                    disabled={!comment.trim() || addComment.isPending}
                    onClick={async () => {
                      if (!openTicketId) return;
                      setError(null);
                      await addComment.mutateAsync({ ticketId: openTicketId, body: comment.trim() });
                    }}
                  >
                    {addComment.isPending ? "Posting…" : "Post"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      ) : null}
    </>
  );
}

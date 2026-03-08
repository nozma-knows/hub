"use client";

import { useMemo, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc-client";

type Status = "todo" | "doing" | "done";

const columns: Array<{ key: Status; title: string }> = [
  { key: "todo", title: "Todo" },
  { key: "doing", title: "Doing" },
  { key: "done", title: "Done" }
];

export function TicketsPage() {
  const utils = trpc.useUtils();
  const tickets = trpc.tickets.list.useQuery();
  const agents = trpc.agents.list.useQuery();

  const create = trpc.tickets.create.useMutation({
    onSuccess: async () => {
      await utils.tickets.list.invalidate();
      setTitle("");
      setDescription("");
    },
    onError: (e) => setError(e.message)
  });

  const move = trpc.tickets.move.useMutation({
    onSuccess: async () => {
      await utils.tickets.list.invalidate();
    },
    onError: (e) => setError(e.message)
  });

  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ownerAgentId, setOwnerAgentId] = useState<string>("");

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
    const map: Record<Status, any[]> = { todo: [], doing: [], done: [] };
    for (const t of tickets.data ?? []) {
      const key = (t.status as Status) || "todo";
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
          <p className="text-sm text-muted-foreground">Hub-native Kanban board (Todo / Doing / Done).</p>
        </div>
      </div>

      {error ? <Alert className="border-destructive text-destructive">{error}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>New ticket</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" />
          </div>
          <div className="space-y-1">
            <Label>Owner (agent)</Label>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={ownerAgentId}
              onChange={(e) => setOwnerAgentId(e.target.value)}
            >
              <option value="">Unassigned</option>
              {(agents.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.id})
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2 space-y-1">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-24" />
          </div>
          <div className="md:col-span-2">
            <Button
              disabled={!title.trim() || create.isPending}
              onClick={() => {
                setError(null);
                create.mutate({
                  title: title.trim(),
                  description: description.trim() || undefined,
                  ownerAgentId: ownerAgentId || undefined
                });
              }}
            >
              {create.isPending ? "Creating…" : "Create"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
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
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-2xl rounded-lg bg-background shadow-lg">
          <div className="flex items-start justify-between gap-3 border-b p-4">
            <div className="min-w-0">
              <div className="text-lg font-semibold truncate">{ticketDetail.data?.ticket.title ?? "Ticket"}</div>
              <div className="mt-1 text-xs text-muted-foreground">Status: {ticketDetail.data?.ticket.status}</div>
            </div>
            <Button variant="outline" onClick={() => setOpenTicketId(null)}>
              Close
            </Button>
          </div>

          <div className="space-y-4 p-4">
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
              <div className="max-h-[35vh] overflow-auto space-y-2 rounded-md border p-3">
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

              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add a comment…"
                className="min-h-20"
              />
              <div className="flex justify-end">
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
      ) : null}
    </>
  );
}

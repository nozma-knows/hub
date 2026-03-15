export type HubAction =
  | { kind: "set_ticket_state"; status: string; note?: string }
  | { kind: "collab.assign"; assign: Array<{ agentId: string; task: string }> };

export function extractHubActions(output: string): HubAction[] {
  const re = /```hub-action\s*([\s\S]*?)```/gi;
  const actions: HubAction[] = [];

  for (const match of output.matchAll(re)) {
    const raw = match[1]?.trim();
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw) as any;

      if (parsed?.kind === "set_ticket_state") {
        if (typeof parsed.status !== "string" || !parsed.status.trim()) continue;
        const note = typeof parsed.note === "string" && parsed.note.trim() ? parsed.note.trim() : undefined;
        actions.push({ kind: "set_ticket_state", status: parsed.status.trim(), note });
        continue;
      }

      if (parsed?.kind === "collab.assign") {
        const list = Array.isArray(parsed.assign) ? parsed.assign : [];
        const assign = list
          .map((a: any) => ({ agentId: String(a?.agentId ?? "").trim(), task: String(a?.task ?? "").trim() }))
          .filter((a: any) => a.agentId && a.task);
        if (assign.length === 0) continue;
        actions.push({ kind: "collab.assign", assign });
        continue;
      }
    } catch {
      // ignore bad blocks
    }
  }

  return actions;
}

export function normalizeTicketStatus(
  status: string
): "backlog" | "todo" | "in_progress" | "done" | "canceled" {
  // accept legacy values and synonyms
  const s = status.toLowerCase();
  if (s === "doing" || s === "inprogress" || s === "in_progress") return "in_progress";
  if (s === "backlog") return "backlog";
  if (s === "todo" || s === "to-do" || s === "to_do") return "todo";
  if (s === "done" || s === "complete" || s === "completed") return "done";
  if (s === "canceled" || s === "cancelled" || s === "wont_do" || s === "won't do") return "canceled";
  return "todo";
}

export function isStuckTicket(
  ticket: {
    status: string;
    dispatchState: string;
    updatedAt: Date;
    lastDispatchedAt: Date | null;
  },
  stuckMs: number,
  nowMs: number = Date.now()
): boolean {
  if (ticket.status !== "in_progress" && ticket.status !== "doing") return false;
  if (ticket.dispatchState === "running" || ticket.dispatchState === "needs_input") return false;

  // Prefer lastDispatchedAt when available; fall back to updatedAt.
  const t = ticket.lastDispatchedAt ?? ticket.updatedAt;
  const ms = new Date(t).getTime();
  if (nowMs - ms < stuckMs) return false;
  return true;
}

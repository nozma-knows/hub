import { randomUUID } from "node:crypto";

import { and, eq, isNull, lt, or } from "drizzle-orm";

import { hubDispatcherState, hubTicketComments, hubTickets } from "@/db/schema";

function extractTicketAction(output: string): { kind: "set_ticket_state"; status: string; note?: string } | null {
  const match = output.match(/```hub-action\s*([\s\S]*?)```/i);
  if (!match) return null;
  const raw = match[1]?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as any;
    if (parsed?.kind !== "set_ticket_state") return null;
    if (typeof parsed.status !== "string" || !parsed.status.trim()) return null;
    const note = typeof parsed.note === "string" && parsed.note.trim() ? parsed.note.trim() : undefined;
    return { kind: "set_ticket_state", status: parsed.status.trim(), note };
  } catch {
    return null;
  }
}

function normalizeTicketStatus(status: string): "backlog" | "todo" | "in_progress" | "done" | "canceled" {
  // accept legacy values and synonyms
  const s = status.toLowerCase();
  if (s === "doing" || s === "inprogress" || s === "in_progress") return "in_progress";
  if (s === "backlog") return "backlog";
  if (s === "todo" || s === "to-do" || s === "to_do") return "todo";
  if (s === "done" || s === "complete" || s === "completed") return "done";
  if (s === "canceled" || s === "cancelled" || s === "wont_do" || s === "won't do") return "canceled";
  return "todo";
}

import { db } from "@/lib/db";
import { openClawAgentTurn } from "@/lib/openclaw/cli-adapter";

const dispatcherKey = Symbol.for("openclaw-hub.dispatcher.interval");

type GlobalDispatcher = typeof globalThis & {
  [dispatcherKey]?: NodeJS.Timeout;
};

const INTERVAL_MS = Number(process.env.HUB_DISPATCHER_INTERVAL_MS ?? 120_000);
const MAX_PER_TICK = Number(process.env.HUB_DISPATCHER_MAX_PER_TICK ?? 2);
const COOLDOWN_MS = Number(process.env.HUB_DISPATCHER_COOLDOWN_MS ?? 5 * 60_000);
const LOCK_TTL_MS = Number(process.env.HUB_DISPATCHER_LOCK_TTL_MS ?? 10 * 60_000);

function enabled() {
  return (process.env.HUB_DISPATCHER_ENABLED ?? "true").toLowerCase() === "true";
}

export function startDispatcher(): void {
  if (!enabled()) {
    console.log("⏸️ Hub dispatcher disabled (HUB_DISPATCHER_ENABLED=false)");
    return;
  }

  const g = globalThis as GlobalDispatcher;
  if (g[dispatcherKey]) return;

  console.log(`🤖 Starting Hub ticket dispatcher (interval=${INTERVAL_MS}ms)`);

  let isRunning = false;

  const tick = async () => {
    if (isRunning) return;
    isRunning = true;

    try {
      // eslint-disable-next-line no-console
      console.log("🤖 Dispatcher tick");

      // Heartbeat: record that the dispatcher loop is alive.
      // Best-effort: never let health telemetry break the dispatcher.
      try {
        await db
          .insert(hubDispatcherState)
          .values({ key: "main", lastTickAt: new Date(), lastError: null, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: hubDispatcherState.key,
            set: { lastTickAt: new Date(), lastError: null, updatedAt: new Date() }
          });
      } catch {
        // ignore
      }
      const now = new Date();
      const lockExpiresAt = new Date(Date.now() + LOCK_TTL_MS);

      // Pull a small batch of candidate tickets.
      // Also recover tickets that were moved to Doing but have an expired lock (crash/restart mid-run).
      const candidates = await db.query.hubTickets.findMany({
        where: and(
          or(
            eq(hubTickets.status, "todo"),
            eq(hubTickets.status, "backlog"),
            and(
              or(eq(hubTickets.status, "in_progress"), eq(hubTickets.status, "doing")),
              eq(hubTickets.dispatchState, "running"),
              lt(hubTickets.dispatchLockExpiresAt, now)
            )
          ),
          or(isNull(hubTickets.dispatchLockExpiresAt), lt(hubTickets.dispatchLockExpiresAt, now))
        ),
        orderBy: (t, { asc }) => [asc(t.updatedAt)],
        limit: 25
      });

      const due = candidates
        .filter((t) => Boolean(t.ownerAgentId))
        // Don't spam the same ticket unless the previous lock expired (recovery)
        .filter((t) => {
          const last = t.lastDispatchedAt ? new Date(t.lastDispatchedAt).getTime() : null;
          const lockExpired = !t.dispatchLockExpiresAt || new Date(t.dispatchLockExpiresAt).getTime() < Date.now();
          if (lockExpired && t.dispatchState === "running") return true;
          if (!last) return true;
          return Date.now() - last > COOLDOWN_MS;
        })
        .slice(0, MAX_PER_TICK);

      // eslint-disable-next-line no-console
      console.log(`🤖 Dispatcher candidates=${candidates.length} due=${due.length}`);

      for (const ticket of due) {
        const lockId = randomUUID();

        // Attempt to lock (best-effort optimistic) and move to Doing so it doesn't look stuck.
        const updated = await db
          .update(hubTickets)
          .set({
            status: "in_progress",
            dispatchState: "running",
            dispatchLockId: lockId,
            dispatchLockExpiresAt: lockExpiresAt,
            lastDispatchedAt: new Date(),
            lastDispatchError: null,
            updatedAt: new Date()
          })
          .where(
            and(
              eq(hubTickets.id, ticket.id),
              or(
                eq(hubTickets.status, "todo"),
                eq(hubTickets.status, "backlog"),
                eq(hubTickets.status, "in_progress"),
                eq(hubTickets.status, "doing")
              ),
              or(isNull(hubTickets.dispatchLockExpiresAt), lt(hubTickets.dispatchLockExpiresAt, now))
            )
          )
          .returning();

        if (!updated || updated.length === 0) continue;

        // Record start
        await db.insert(hubTicketComments).values({
          workspaceId: ticket.workspaceId,
          ticketId: ticket.id,
          authorType: "system",
          body: `🤖 Dispatcher: running owner agent (${ticket.ownerAgentId})…`
        });

        try {
          const prompt = `You are working a Hub ticket.

Title: ${ticket.title}

Description:
${ticket.description || "(none)"}

If you believe the ticket state should change, include a fenced JSON block like:
\`\`\`hub-action
{"kind":"set_ticket_state","status":"done","note":"short reason"}
\`\`\`

Return:
- what you did
- what changed
- next steps
- blockers/questions (if any)`;

          const result = await openClawAgentTurn({
            agentId: ticket.ownerAgentId!,
            message: prompt,
            timeoutSeconds: 600
          });

          const output = (result.output || "").toString().trim() || "(no output)";

          await db.insert(hubTicketComments).values({
            workspaceId: ticket.workspaceId,
            ticketId: ticket.id,
            authorType: "agent",
            authorAgentId: ticket.ownerAgentId!,
            body: output
          });

          const action = extractTicketAction(output);
          const nextStatus = action ? normalizeTicketStatus(action.status) : null;

          if (nextStatus) {
            await db.insert(hubTicketComments).values({
              workspaceId: ticket.workspaceId,
              ticketId: ticket.id,
              authorType: "system",
              body: `✅ State updated by agent: ${nextStatus}${action?.note ? ` — ${action.note}` : ""}`
            });
          }

          await db
            .update(hubTickets)
            .set({
              status: nextStatus ?? "in_progress",
              dispatchState: "idle",
              dispatchLockId: null,
              dispatchLockExpiresAt: null,
              updatedAt: new Date()
            })
            .where(and(eq(hubTickets.id, ticket.id), eq(hubTickets.dispatchLockId, lockId)));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);

          await db.insert(hubTicketComments).values({
            workspaceId: ticket.workspaceId,
            ticketId: ticket.id,
            authorType: "system",
            body: `⚠️ Dispatcher failed: ${msg}`
          });

          await db
            .update(hubTickets)
            .set({
              status: "todo",
              dispatchState: "error",
              lastDispatchError: msg,
              dispatchLockId: null,
              dispatchLockExpiresAt: null,
              updatedAt: new Date()
            })
            .where(and(eq(hubTickets.id, ticket.id), eq(hubTickets.dispatchLockId, lockId)));
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      try {
        await db
          .insert(hubDispatcherState)
          .values({ key: "main", lastTickAt: new Date(), lastError: msg, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: hubDispatcherState.key,
            set: { lastTickAt: new Date(), lastError: msg, updatedAt: new Date() }
          });
      } catch {
        // ignore
      }

      // eslint-disable-next-line no-console
      console.error("🤖 Dispatcher tick failed", err);
    } finally {
      isRunning = false;
    }
  };

  void tick();
  g[dispatcherKey] = setInterval(() => void tick(), INTERVAL_MS);
}

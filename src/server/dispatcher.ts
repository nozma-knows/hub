import { randomUUID } from "node:crypto";

import { and, eq, isNull, lt, or } from "drizzle-orm";

import { hubTicketComments, hubTickets } from "@/db/schema";
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
      const now = new Date();
      const lockExpiresAt = new Date(Date.now() + LOCK_TTL_MS);

      // Pull a small batch of candidate tickets.
      const candidates = await db.query.hubTickets.findMany({
        where: and(
          eq(hubTickets.status, "todo"),
          // must have owner
          // (null owner means it won't be picked up automatically)
          // drizzle doesn't have isNotNull helper here; use != null by OR
          // We'll filter in JS.
          // lock must be free or expired
          or(
            isNull(hubTickets.dispatchLockExpiresAt),
            lt(hubTickets.dispatchLockExpiresAt, now)
          )
        ),
        orderBy: (t, { asc }) => [asc(t.updatedAt)],
        limit: 25
      });

      const due = candidates
        .filter((t) => Boolean(t.ownerAgentId))
        .filter((t) => !t.lastDispatchedAt || Date.now() - new Date(t.lastDispatchedAt).getTime() > COOLDOWN_MS)
        .slice(0, MAX_PER_TICK);

      for (const ticket of due) {
        const lockId = randomUUID();

        // Attempt to lock (best-effort optimistic) and immediately move to Doing so it doesn't look stuck.
        const updated = await db
          .update(hubTickets)
          .set({
            status: "doing",
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
              eq(hubTickets.status, "todo"),
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

          // Move to doing after first successful run (keeps board honest)
          await db
            .update(hubTickets)
            .set({
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
    } catch {
      // keep loop alive
    } finally {
      isRunning = false;
    }
  };

  void tick();
  g[dispatcherKey] = setInterval(() => void tick(), INTERVAL_MS);
}

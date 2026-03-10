import { randomUUID } from "node:crypto";

import { and, eq, isNull, lt, or } from "drizzle-orm";

import { hubDispatcherState, hubSkillInstalls, hubTicketComments, hubTickets } from "@/db/schema";

function isStuckTicket(ticket: { status: string; dispatchState: string; updatedAt: Date; lastDispatchedAt: Date | null }) {
  if (ticket.status !== "in_progress" && ticket.status !== "doing") return false;
  if (ticket.dispatchState === "running") return false;
  const updatedMs = new Date(ticket.updatedAt).getTime();
  if (Date.now() - updatedMs < STUCK_MS) return false;
  return true;
}

async function hasRecentAutoRetry(ticketId: string): Promise<boolean> {
  try {
    const recent = await db.query.hubTicketComments.findMany({
      where: eq(hubTicketComments.ticketId, ticketId),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
      limit: 30
    });

    const cutoff = Date.now() - AUTO_RETRY_WINDOW_MS;
    return recent.some((c: any) =>
      typeof c.body === "string" && c.body.includes("🔁 Auto-retry") && new Date(c.createdAt).getTime() > cutoff
    );
  } catch {
    return false;
  }
}

async function lastCommentAt(ticketId: string): Promise<number | null> {
  try {
    const rows = await db.query.hubTicketComments.findMany({
      where: eq(hubTicketComments.ticketId, ticketId),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
      limit: 1
    });
    const row: any = rows?.[0];
    return row?.createdAt ? new Date(row.createdAt).getTime() : null;
  } catch {
    return null;
  }
}


type HubAction =
  | { kind: "set_ticket_state"; status: string; note?: string }
  | { kind: "collab.assign"; assign: Array<{ agentId: string; task: string }> };

function extractHubActions(output: string): HubAction[] {
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
const STUCK_MS = Number(process.env.HUB_DISPATCHER_STUCK_MS ?? 20 * 60_000);
const AUTO_RETRY_WINDOW_MS = Number(process.env.HUB_DISPATCHER_AUTO_RETRY_WINDOW_MS ?? 6 * 60 * 60_000);

const SKILL_INSTALL_LOCK_TTL_MS = Number(process.env.HUB_SKILL_INSTALL_LOCK_TTL_MS ?? 15 * 60_000);
const SKILL_INSTALL_MAX_PER_TICK = Number(process.env.HUB_SKILL_INSTALL_MAX_PER_TICK ?? 1);

function enabled() {
  return (process.env.HUB_DISPATCHER_ENABLED ?? "true").toLowerCase() === "true";
}

async function runSkillInstallerTick() {
  const now = new Date();
  const lockExpiresAt = new Date(Date.now() + SKILL_INSTALL_LOCK_TTL_MS);

  const candidates = await db.query.hubSkillInstalls.findMany({
    where: and(
      or(eq(hubSkillInstalls.status, "queued"), eq(hubSkillInstalls.status, "installing")),
      or(isNull(hubSkillInstalls.lockExpiresAt), lt(hubSkillInstalls.lockExpiresAt, now))
    ),
    orderBy: (t, { asc }) => [asc(t.updatedAt)],
    limit: 10
  });

  const due = candidates.slice(0, SKILL_INSTALL_MAX_PER_TICK);
  if (due.length === 0) return;

  for (const row of due) {
    const lockId = randomUUID();

    const updated = await db
      .update(hubSkillInstalls)
      .set({
        status: "installing",
        statusDetail: "Installing",
        progress: 10,
        lockId,
        lockExpiresAt,
        installStartedAt: row.installStartedAt ?? new Date(),
        attempts: (row.attempts ?? 0) + 1,
        error: null,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(hubSkillInstalls.id, row.id),
          or(isNull(hubSkillInstalls.lockExpiresAt), lt(hubSkillInstalls.lockExpiresAt, now))
        )
      )
      .returning();

    if (!updated || updated.length === 0) continue;

    const slug = row.clawhubSkillId;
    const version = row.version?.trim() || "";

    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);

      // Install into OpenClaw managed skills dir (~/.openclaw/skills)
      const workdir = "/root/.openclaw";
      const args = [
        "--bun",
        "clawhub@latest",
        "install",
        slug,
        "--workdir",
        workdir,
        "--dir",
        "skills",
        "--no-input"
      ];
      if (version) args.push("--version", version);

      await db
        .update(hubSkillInstalls)
        .set({ statusDetail: "Downloading/Installing", progress: 30, updatedAt: new Date() })
        .where(and(eq(hubSkillInstalls.id, row.id), eq(hubSkillInstalls.lockId, lockId)));

      const res: any = await execFileAsync("bunx", args, {
        timeout: 10 * 60_000,
        maxBuffer: 5 * 1024 * 1024
      });

      const out = String(res?.stdout ?? "");
      const err = String(res?.stderr ?? "");
      const logs = (out + "\n" + err).trim().slice(-20_000);

      await db
        .update(hubSkillInstalls)
        .set({
          status: "installed",
          statusDetail: "Installed",
          progress: 100,
          logs,
          installedAt: new Date(),
          finishedAt: new Date(),
          lockId: null,
          lockExpiresAt: null,
          updatedAt: new Date()
        })
        .where(and(eq(hubSkillInstalls.id, row.id), eq(hubSkillInstalls.lockId, lockId)));
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      const out = String((err as any)?.stdout ?? "");
      const eout = String((err as any)?.stderr ?? "");
      const logs = (out + "\n" + eout).trim().slice(-20_000);

      const isRateLimited = /rate limit/i.test(msg) || /rate limit/i.test(logs);
      if (isRateLimited && (row.attempts ?? 0) < 2) {
        // Backoff: re-queue and don't pick it up again until lockExpiresAt.
        const backoffMs = 10 * 60_000;
        await db
          .update(hubSkillInstalls)
          .set({
            status: "queued",
            statusDetail: `Rate limited — retrying in ${Math.round(backoffMs / 60_000)}m`,
            progress: 0,
            error: msg.slice(0, 2_000),
            logs: logs || null,
            lockId: null,
            lockExpiresAt: new Date(Date.now() + backoffMs),
            updatedAt: new Date()
          })
          .where(and(eq(hubSkillInstalls.id, row.id), eq(hubSkillInstalls.lockId, lockId)));
        continue;
      }

      await db
        .update(hubSkillInstalls)
        .set({
          status: "failed",
          statusDetail: "Failed",
          progress: 100,
          error: msg.slice(0, 8_000),
          logs: logs || null,
          finishedAt: new Date(),
          lockId: null,
          lockExpiresAt: null,
          updatedAt: new Date()
        })
        .where(and(eq(hubSkillInstalls.id, row.id), eq(hubSkillInstalls.lockId, lockId)));
    }
  }
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

      // Identify stuck tickets (in_progress but no dispatcher activity for a while).
      // Policy: auto-retry once (per window) so humans aren't left guessing.
      const stuck: typeof candidates = [];
      for (const t of candidates) {
        if (!t.ownerAgentId) continue;
        if (!isStuckTicket({
          status: t.status as any,
          dispatchState: (t.dispatchState as any) ?? "idle",
          updatedAt: t.updatedAt as any,
          lastDispatchedAt: (t.lastDispatchedAt as any) ?? null
        })) {
          continue;
        }

        const lastAt = await lastCommentAt(t.id);
        if (lastAt && Date.now() - lastAt < STUCK_MS) continue;

        if (await hasRecentAutoRetry(t.id)) continue;
        stuck.push(t);
        if (stuck.length >= MAX_PER_TICK) break;
      }

      const due = [...stuck,
        ...candidates
          .filter((t) => Boolean(t.ownerAgentId))
          // Don't spam the same ticket unless the previous lock expired (recovery)
          .filter((t) => {
            const last = t.lastDispatchedAt ? new Date(t.lastDispatchedAt).getTime() : null;
            const lockExpired =
              !t.dispatchLockExpiresAt || new Date(t.dispatchLockExpiresAt).getTime() < Date.now();
            if (lockExpired && t.dispatchState === "running") return true;
            if (!last) return true;
            return Date.now() - last > COOLDOWN_MS;
          })
      ].slice(0, MAX_PER_TICK);

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

        const ownerAgentId = ticket.ownerAgentId || "main";

        // Record start
        if (stuck.some((s) => s.id === ticket.id)) {
          await db.insert(hubTicketComments).values({
            workspaceId: ticket.workspaceId,
            ticketId: ticket.id,
            authorType: "system",
            body: `🔁 Auto-retry (1/1): no updates for ${Math.round(STUCK_MS / 60_000)}m. Re-running owner agent (${ownerAgentId})…`
          });
        } else {
          await db.insert(hubTicketComments).values({
            workspaceId: ticket.workspaceId,
            ticketId: ticket.id,
            authorType: "system",
            body: `🤖 Dispatcher: running owner agent (${ownerAgentId})…`
          });
        }

        try {
          const prompt = `You are working a Hub ticket as a coordinator.

Title: ${ticket.title}

Description:
${ticket.description || "(none)"}

Collaboration (use specialists when helpful):
- dev: UI/Next.js/React/TypeScript implementation
- ops: deployments/systemd/reliability/perf/infra
- research: options, tradeoffs, best practices, edge cases

Collab templates (preferred defaults):
- UI/product change → assign: dev + research
- Reliability/infra/deploy/perf → assign: ops (+ dev if code changes)
- Integrations (Slack/Linear/auth) → assign: dev + ops + research
- Ambiguous/large → assign: research first, then decide

To spawn specialists, emit exactly one action block:
\`\`\`hub-action
{"kind":"collab.assign","assign":[{"agentId":"dev","task":"..."},{"agentId":"ops","task":"..."}]}
\`\`\`

If you believe the ticket state should change, include:
\`\`\`hub-action
{"kind":"set_ticket_state","status":"done","note":"short reason"}
\`\`\`

Return:
- what you did
- what changed
- next steps
- blockers/questions (if any)`;

          const result = await openClawAgentTurn({
            agentId: ownerAgentId,
            message: prompt,
            timeoutSeconds: 600
          });

          const output = (result.output || "").toString().trim() || "(no output)";

          await db.insert(hubTicketComments).values({
            workspaceId: ticket.workspaceId,
            ticketId: ticket.id,
            authorType: "agent",
            authorAgentId: ownerAgentId,
            body: output
          });

          const actions = extractHubActions(output);

          const stateAction = actions.find((a) => a.kind === "set_ticket_state") as
            | { kind: "set_ticket_state"; status: string; note?: string }
            | undefined;

          const collabAction = actions.find((a) => a.kind === "collab.assign") as
            | { kind: "collab.assign"; assign: Array<{ agentId: string; task: string }> }
            | undefined;

          const nextStatus = stateAction ? normalizeTicketStatus(stateAction.status) : null;

          // If coordinator requested collaboration, run specialist turns and then re-invoke coordinator.
          if (collabAction) {
            await db.insert(hubTicketComments).values({
              workspaceId: ticket.workspaceId,
              ticketId: ticket.id,
              authorType: "system",
              body: `🤝 Collaboration: spawning ${collabAction.assign.length} specialist run(s)…`
            });

            const results: Array<{ agentId: string; task: string; output: string }> = [];

            for (const item of collabAction.assign) {
              await db.insert(hubTicketComments).values({
                workspaceId: ticket.workspaceId,
                ticketId: ticket.id,
                authorType: "system",
                body: `🤖 Running ${item.agentId}: ${item.task}`
              });

              const specialist = await openClawAgentTurn({
                agentId: item.agentId,
                message: `You are a specialist agent helping on a Hub ticket.\n\nTicket title: ${ticket.title}\n\nTicket description:\n${ticket.description || "(none)"}\n\nYour task:\n${item.task}\n\nReturn a concise result with:\n- findings/changes\n- any commands run\n- next steps\n- blockers`,
                timeoutSeconds: 600
              });

              const specialistOutput = (specialist.output || "").toString().trim() || "(no output)";

              results.push({ agentId: item.agentId, task: item.task, output: specialistOutput });

              await db.insert(hubTicketComments).values({
                workspaceId: ticket.workspaceId,
                ticketId: ticket.id,
                authorType: "agent",
                authorAgentId: item.agentId,
                body: specialistOutput
              });
            }

            // Re-invoke coordinator to integrate.
            const summary = results
              .map((r) => `- ${r.agentId}: ${r.task}\n${r.output}`)
              .join("\n\n");

            await db.insert(hubTicketComments).values({
              workspaceId: ticket.workspaceId,
              ticketId: ticket.id,
              authorType: "system",
              body: `🧠 Coordinator (${ownerAgentId}): integrating specialist results…`
            });

            const coordinator = await openClawAgentTurn({
              agentId: ownerAgentId,
              message: `You are the coordinator agent for this Hub ticket. Specialists have reported back.

Ticket title: ${ticket.title}

Ticket description:
${ticket.description || "(none)"}

Specialist results:
${summary}

Now:
- summarize final plan/results
- update the ticket state if appropriate using a fenced hub-action block

Use:

\`\`\`hub-action
{"kind":"set_ticket_state","status":"done","note":"short reason"}
\`\`\`
`,
              timeoutSeconds: 600
            });

            const coordOut = (coordinator.output || "").toString().trim() || "(no output)";
            await db.insert(hubTicketComments).values({
              workspaceId: ticket.workspaceId,
              ticketId: ticket.id,
              authorType: "agent",
              authorAgentId: ownerAgentId,
              body: coordOut
            });

            const postActions = extractHubActions(coordOut);
            const postState = postActions.find((a) => a.kind === "set_ticket_state") as
              | { kind: "set_ticket_state"; status: string; note?: string }
              | undefined;
            const postNextStatus = postState ? normalizeTicketStatus(postState.status) : null;

            if (postNextStatus) {
              await db.insert(hubTicketComments).values({
                workspaceId: ticket.workspaceId,
                ticketId: ticket.id,
                authorType: "system",
                body: `✅ State updated by coordinator: ${postNextStatus}${postState?.note ? ` — ${postState.note}` : ""}`
              });
            }

            await db
              .update(hubTickets)
              .set({
                status: postNextStatus ?? nextStatus ?? "in_progress",
                dispatchState: "idle",
                dispatchLockId: null,
                dispatchLockExpiresAt: null,
                updatedAt: new Date()
              })
              .where(and(eq(hubTickets.id, ticket.id), eq(hubTickets.dispatchLockId, lockId)));

            continue;
          }

          if (nextStatus) {
            await db.insert(hubTicketComments).values({
              workspaceId: ticket.workspaceId,
              ticketId: ticket.id,
              authorType: "system",
              body: `✅ State updated by agent: ${nextStatus}${stateAction?.note ? ` — ${stateAction.note}` : ""}`
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

      // Process skill installs (best-effort) after ticket work.
      try {
        await runSkillInstallerTick();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("🧩 Skill installer tick failed", err);
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

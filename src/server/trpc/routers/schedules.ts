import { z } from "zod";

import { createTrpcRouter, protectedProcedure } from "../init";
import { openClawCliAdapter } from "@/lib/openclaw/cli-adapter";

function shQuote(s: string) {
  // Minimal safe shell quoting for our CLI calls.
  return `'${s.replace(/'/g, `'"'"'`)}'`;
}

export type HubSchedule = {
  id: string;
  name: string;
  enabled: boolean;
  agentId?: string;
  sessionTarget?: "main" | "isolated";
  schedule?: { kind: "at" | "every" | "cron"; value: string; tz?: string };
  payload?: { kind: "systemEvent" | "agentTurn"; text: string };
  delivery?: { announce: boolean; channel?: string; to?: string };
  raw?: any;
};

function parseCronListJson(raw: any): HubSchedule[] {
  const jobs = Array.isArray(raw?.jobs) ? raw.jobs : Array.isArray(raw) ? raw : [];
  return jobs
    .map((j: any) => {
      const schedule = j?.schedule;
      let sched: HubSchedule["schedule"] | undefined;
      if (schedule?.kind === "at") sched = { kind: "at", value: String(schedule.at ?? "") };
      if (schedule?.kind === "every") sched = { kind: "every", value: String(schedule.everyMs ?? schedule.every ?? "") };
      if (schedule?.kind === "cron") sched = { kind: "cron", value: String(schedule.expr ?? ""), tz: schedule.tz ? String(schedule.tz) : undefined };

      const payload = j?.payload;
      let pay: HubSchedule["payload"] | undefined;
      if (payload?.kind === "systemEvent") pay = { kind: "systemEvent", text: String(payload.text ?? "") };
      if (payload?.kind === "agentTurn") pay = { kind: "agentTurn", text: String(payload.message ?? payload.text ?? "") };

      const delivery = j?.delivery;
      const announce = delivery?.mode === "announce" || Boolean(j?.announce);

      return {
        id: String(j.id ?? j.jobId ?? ""),
        name: String(j.name ?? "(unnamed)"),
        enabled: Boolean(j.enabled ?? true),
        agentId: j.agentId ? String(j.agentId) : undefined,
        sessionTarget: j.sessionTarget === "main" || j.sessionTarget === "isolated" ? j.sessionTarget : undefined,
        schedule: sched,
        payload: pay,
        delivery: { announce, channel: delivery?.channel, to: delivery?.to },
        raw: j
      } satisfies HubSchedule;
    })
    .filter((j: HubSchedule) => Boolean(j.id));
}

export const schedulesRouter = createTrpcRouter({
  list: protectedProcedure.query(async () => {
    const out = await openClawCliAdapter.runCommand("openclaw cron list --all --json", { timeoutMs: 30000 });
    const parsed = JSON.parse(out);
    return parseCronListJson(parsed);
  }),

  add: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(120),
        enabled: z.boolean().default(true),
        agentId: z.string().min(1).default("cos"),
        sessionTarget: z.enum(["isolated", "main"]).default("isolated"),
        scheduleKind: z.enum(["every", "cron", "at"]),
        scheduleValue: z.string().min(1),
        tz: z.string().optional(),
        message: z.string().min(1),
        announce: z.boolean().default(true)
      })
    )
    .mutation(async ({ input }) => {
      const args: string[] = [];
      args.push("openclaw cron add");
      args.push("--name", shQuote(input.name));
      if (!input.enabled) args.push("--disabled");
      args.push("--agent", shQuote(input.agentId));
      args.push("--session", shQuote(input.sessionTarget));

      if (input.scheduleKind === "every") args.push("--every", shQuote(input.scheduleValue));
      if (input.scheduleKind === "cron") {
        args.push("--cron", shQuote(input.scheduleValue));
        if (input.tz) args.push("--tz", shQuote(input.tz));
      }
      if (input.scheduleKind === "at") args.push("--at", shQuote(input.scheduleValue));

      // Payload: for isolated use --message; for main use --system-event.
      if (input.sessionTarget === "main") args.push("--system-event", shQuote(input.message));
      else args.push("--message", shQuote(input.message));

      if (input.announce) args.push("--announce");
      args.push("--json");

      const cmd = args.join(" ");
      const out = await openClawCliAdapter.runCommand(cmd, { timeoutMs: 30000 });
      try {
        return { ok: true, raw: JSON.parse(out) };
      } catch {
        return { ok: true, raw: out };
      }
    }),

  edit: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(120).optional(),
        enabled: z.boolean().optional(),
        agentId: z.string().min(1).optional(),
        sessionTarget: z.enum(["isolated", "main"]).optional(),
        scheduleKind: z.enum(["every", "cron", "at"]).optional(),
        scheduleValue: z.string().min(1).optional(),
        tz: z.string().optional(),
        message: z.string().min(1).optional(),
        announce: z.boolean().optional()
      })
    )
    .mutation(async ({ input }) => {
      const args: string[] = [];
      args.push("openclaw cron edit", shQuote(input.id));
      if (input.name) args.push("--name", shQuote(input.name));
      if (input.enabled === true) args.push("--enable");
      if (input.enabled === false) args.push("--disable");
      if (input.agentId) args.push("--agent", shQuote(input.agentId));
      if (input.sessionTarget) args.push("--session", shQuote(input.sessionTarget));

      if (input.scheduleKind && input.scheduleValue) {
        if (input.scheduleKind === "every") args.push("--every", shQuote(input.scheduleValue));
        if (input.scheduleKind === "at") args.push("--at", shQuote(input.scheduleValue));
        if (input.scheduleKind === "cron") {
          args.push("--cron", shQuote(input.scheduleValue));
          if (input.tz) args.push("--tz", shQuote(input.tz));
        }
      }

      if (input.message) {
        // We don't know the job's sessionTarget reliably here; send both flags is invalid.
        // Default: treat as agent job payload.
        args.push("--message", shQuote(input.message));
      }

      if (input.announce === true) args.push("--announce");
      if (input.announce === false) args.push("--no-deliver");

      const cmd = args.join(" ");
      const out = await openClawCliAdapter.runCommand(cmd, { timeoutMs: 30000 });
      return { ok: true, raw: out };
    }),

  remove: protectedProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ input }) => {
    const out = await openClawCliAdapter.runCommand(`openclaw cron rm ${shQuote(input.id)}`, { timeoutMs: 30000 });
    return { ok: true, raw: out };
  }),

  runNow: protectedProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ input }) => {
    const out = await openClawCliAdapter.runCommand(`openclaw cron run ${shQuote(input.id)}`, { timeoutMs: 30000 });
    return { ok: true, raw: out };
  })
});

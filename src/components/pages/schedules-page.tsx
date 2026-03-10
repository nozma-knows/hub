"use client";

import { useMemo, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc-client";

type ScheduleKind = "every" | "cron" | "at";

type Draft = {
  name: string;
  enabled: boolean;
  agentId: string;
  sessionTarget: "isolated" | "main";
  scheduleKind: ScheduleKind;
  scheduleValue: string;
  tz?: string;
  message: string;
  announce: boolean;
};

const defaultDraft: Draft = {
  name: "",
  enabled: true,
  agentId: "cos",
  sessionTarget: "isolated",
  scheduleKind: "every",
  scheduleValue: "10m",
  tz: "",
  message: "",
  announce: true
};

export function SchedulesPage() {
  const utils = trpc.useUtils();
  const list = trpc.schedules.list.useQuery();
  const add = trpc.schedules.add.useMutation({
    onSuccess: async () => {
      await utils.schedules.list.invalidate();
      setOpen(false);
      setDraft(defaultDraft);
    },
    onError: (e) => setError(e.message)
  });
  const edit = trpc.schedules.edit.useMutation({
    onSuccess: async () => {
      await utils.schedules.list.invalidate();
      setEditId(null);
    },
    onError: (e) => setError(e.message)
  });
  const rm = trpc.schedules.remove.useMutation({
    onSuccess: async () => {
      await utils.schedules.list.invalidate();
    },
    onError: (e) => setError(e.message)
  });
  const runNow = trpc.schedules.runNow.useMutation({
    onError: (e) => setError(e.message)
  });

  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(defaultDraft);

  const [editId, setEditId] = useState<string | null>(null);

  const rows = useMemo(() => list.data ?? [], [list.data]);

  return (
    <div className="h-full min-h-0 overflow-hidden flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold truncate">Schedules</h1>
          <p className="text-sm text-muted-foreground">OpenClaw cron jobs (agent reminders, routines, automations).</p>
        </div>
        <Button onClick={() => setOpen(true)}>New</Button>
      </div>

      {error ? <Alert className="border-destructive text-destructive">{error}</Alert> : null}

      <div className="flex-1 min-h-0 overflow-auto rounded-xl border bg-background">
        <div className="divide-y">
          {rows.map((j) => {
            const scheduleLabel = j.schedule
              ? j.schedule.kind === "cron"
                ? `cron ${j.schedule.value}${j.schedule.tz ? ` (${j.schedule.tz})` : ""}`
                : `${j.schedule.kind} ${j.schedule.value}`
              : "(unknown)";

            return (
              <div key={j.id} className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium truncate">{j.name}</div>
                      {j.enabled ? (
                        <Badge className="bg-emerald-600 text-white">enabled</Badge>
                      ) : (
                        <Badge className="bg-muted text-muted-foreground">disabled</Badge>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      <div>Schedule: {scheduleLabel}</div>
                      <div>Agent: {j.agentId ?? "(default)"} · Session: {j.sessionTarget ?? "(default)"}</div>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEditId((cur) => (cur === j.id ? null : j.id));
                      }}
                    >
                      Edit
                    </Button>
                    <Button variant="outline" onClick={() => runNow.mutate({ id: j.id })}>
                      Run
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        if (!confirm(`Delete schedule "${j.name}"?`)) return;
                        rm.mutate({ id: j.id });
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>

                {editId === j.id ? (
                  <div className="mt-3 rounded-xl border bg-muted/10 p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <div className="text-xs font-medium">Name</div>
                        <input
                          className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm"
                          defaultValue={j.name}
                          onBlur={(e) => edit.mutate({ id: j.id, name: e.target.value })}
                        />
                      </div>
                      <div>
                        <div className="text-xs font-medium">Enabled</div>
                        <div className="mt-2 flex gap-2">
                          <Button variant="outline" onClick={() => edit.mutate({ id: j.id, enabled: true })}>
                            Enable
                          </Button>
                          <Button variant="outline" onClick={() => edit.mutate({ id: j.id, enabled: false })}>
                            Disable
                          </Button>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 text-xs text-muted-foreground">
                      For now, editing schedule/payload is supported via the CLI-flags patcher and will be expanded into a full form next.
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}

          {rows.length === 0 && list.isFetched ? (
            <div className="p-6 text-sm text-muted-foreground">No schedules yet.</div>
          ) : null}
        </div>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 bg-black/50 p-2 sm:p-4">
          <div className="mx-auto flex h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-background shadow-lg">
            <div className="flex items-center justify-between gap-3 border-b p-4">
              <div className="text-lg font-semibold">New schedule</div>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Close
              </Button>
            </div>

            <div className="flex-1 min-h-0 overflow-auto p-4 space-y-4">
              <div>
                <div className="text-xs font-medium">Name</div>
                <input
                  className="mt-1 w-full rounded-md border bg-background px-2 py-2 text-sm"
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="Daily briefing"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-medium">Agent</div>
                  <input
                    className="mt-1 w-full rounded-md border bg-background px-2 py-2 text-sm"
                    value={draft.agentId}
                    onChange={(e) => setDraft((d) => ({ ...d, agentId: e.target.value }))}
                    placeholder="cos"
                  />
                </div>
                <div>
                  <div className="text-xs font-medium">Session target</div>
                  <select
                    className="mt-1 w-full rounded-md border bg-background px-2 py-2 text-sm"
                    value={draft.sessionTarget}
                    onChange={(e) => setDraft((d) => ({ ...d, sessionTarget: e.target.value as any }))}
                  >
                    <option value="isolated">isolated (agent job)</option>
                    <option value="main">main (system event)</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-medium">Schedule</div>
                  <select
                    className="mt-1 w-full rounded-md border bg-background px-2 py-2 text-sm"
                    value={draft.scheduleKind}
                    onChange={(e) => setDraft((d) => ({ ...d, scheduleKind: e.target.value as any }))}
                  >
                    <option value="every">every (e.g. 10m, 1h)</option>
                    <option value="cron">cron (5-field)</option>
                    <option value="at">at (ISO or +duration)</option>
                  </select>
                </div>
                <div>
                  <div className="text-xs font-medium">Value</div>
                  <input
                    className="mt-1 w-full rounded-md border bg-background px-2 py-2 text-sm"
                    value={draft.scheduleValue}
                    onChange={(e) => setDraft((d) => ({ ...d, scheduleValue: e.target.value }))}
                    placeholder={draft.scheduleKind === "cron" ? "0 13 * * *" : draft.scheduleKind === "at" ? "+20m" : "10m"}
                  />
                </div>
              </div>

              {draft.scheduleKind === "cron" ? (
                <div>
                  <div className="text-xs font-medium">Timezone (IANA)</div>
                  <input
                    className="mt-1 w-full rounded-md border bg-background px-2 py-2 text-sm"
                    value={draft.tz ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, tz: e.target.value }))}
                    placeholder="UTC"
                  />
                </div>
              ) : null}

              <div>
                <div className="text-xs font-medium">Message</div>
                <Textarea
                  className="mt-1 min-h-[120px] text-base"
                  value={draft.message}
                  onChange={(e) => setDraft((d) => ({ ...d, message: e.target.value }))}
                  placeholder="What should the agent do?"
                />
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.announce}
                  onChange={(e) => setDraft((d) => ({ ...d, announce: e.target.checked }))}
                />
                Announce results to chat
              </label>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    setError(null);
                    add.mutate({
                      name: draft.name,
                      enabled: draft.enabled,
                      agentId: draft.agentId,
                      sessionTarget: draft.sessionTarget,
                      scheduleKind: draft.scheduleKind,
                      scheduleValue: draft.scheduleValue,
                      tz: draft.tz?.trim() ? draft.tz.trim() : undefined,
                      message: draft.message,
                      announce: draft.announce
                    });
                  }}
                  disabled={add.isPending || !draft.name.trim() || !draft.message.trim() || !draft.scheduleValue.trim()}
                >
                  Create
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

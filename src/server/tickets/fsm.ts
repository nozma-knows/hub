import { assign, createMachine } from "xstate";

export type PendingQuestion = {
  reason?: string;
  question: string;
  choices?: Array<{ label: string; value: string }>;
  next?: string;
};

export type TicketFsmContext = {
  ticketId: string;
  workspaceId: string;
  pendingQuestion: PendingQuestion | null;
  lastNote?: string;
};

export type TicketFsmEvent =
  | { type: "DISPATCH.START" }
  | { type: "DISPATCH.OK"; note?: string }
  | { type: "DISPATCH.ERROR"; error: string }
  | { type: "NEEDS_INPUT"; pending: PendingQuestion }
  | { type: "INPUT.RECEIVED"; answer: string }
  | { type: "DONE.REQUESTED"; verified: boolean; note?: string };

export const ticketMachine = createMachine(
  {
    id: "ticket",
    initial: "idle",
    types: {} as {
      context: TicketFsmContext;
      events: TicketFsmEvent;
    },
    context: ({ input }) => {
      const i = input as any;
      return {
        ticketId: String(i.ticketId),
        workspaceId: String(i.workspaceId),
        pendingQuestion: null
      };
    },
    states: {
      idle: {
        on: {
          "DISPATCH.START": "running",
          NEEDS_INPUT: {
            target: "needs_input",
            actions: "setPending"
          }
        }
      },
      running: {
        on: {
          "DISPATCH.OK": {
            target: "idle",
            actions: "setNote"
          },
          "DISPATCH.ERROR": {
            target: "idle",
            actions: "setNote"
          },
          NEEDS_INPUT: {
            target: "needs_input",
            actions: "setPending"
          },
          "DONE.REQUESTED": {
            target: "done_pending_verification"
          }
        }
      },
      needs_input: {
        on: {
          "INPUT.RECEIVED": {
            target: "running",
            actions: ["clearPending", "setNote"]
          },
          "DISPATCH.START": "running"
        }
      },
      done_pending_verification: {
        on: {
          "DONE.REQUESTED": [
            {
              guard: "isVerified",
              target: "done",
              actions: "setNote"
            },
            {
              target: "running",
              actions: "setNote"
            }
          ],
          NEEDS_INPUT: {
            target: "needs_input",
            actions: "setPending"
          }
        }
      },
      done: {
        type: "final"
      }
    }
  },
  {
    actions: {
      setPending: assign({ pendingQuestion: ({ event }) => (event.type === "NEEDS_INPUT" ? event.pending : null) }),
      clearPending: assign({ pendingQuestion: null }),
      setNote: assign({
        lastNote: ({ event }) => {
          if (event.type === "DISPATCH.OK") return event.note ?? "ok";
          if (event.type === "DISPATCH.ERROR") return event.error;
          if (event.type === "INPUT.RECEIVED") return `input: ${event.answer}`;
          if (event.type === "DONE.REQUESTED") return event.note ?? (event.verified ? "verified" : "unverified");
          return undefined;
        }
      })
    },
    guards: {
      isVerified: ({ event }) => event.type === "DONE.REQUESTED" && event.verified
    }
  }
);

export function extractNeedsInput(text: string): PendingQuestion | null {
  // Very strict parse: expects lines like
  // NEEDS_INPUT: <reason>
  // QUESTION: <question>
  // CHOICES: a|b|c (optional)
  // NEXT: ... (optional)
  const reason = matchLine(text, /^NEEDS_INPUT\s*:\s*(.+)$/im);
  const question = matchLine(text, /^QUESTION\s*:\s*(.+)$/im);
  if (!question) return null;

  const choicesRaw = matchLine(text, /^CHOICES\s*:\s*(.+)$/im);
  const next = matchLine(text, /^WHAT_I_WILL_DO_NEXT\s*:\s*(.+)$/im) ?? matchLine(text, /^NEXT\s*:\s*(.+)$/im);

  const choices = choicesRaw
    ? choicesRaw
        .split(/[|,]/g)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((v) => ({ label: v, value: v }))
    : undefined;

  return { reason: reason ?? undefined, question, choices, next: next ?? undefined };
}

function matchLine(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m?.[1]?.trim() ?? null;
}

import { describe, expect, test } from "bun:test";

import {
  extractHubActions,
  isStuckTicket,
  normalizeTicketStatus,
} from "../src/server/dispatcher-helpers";

describe("dispatcher helpers", () => {
  describe("normalizeTicketStatus", () => {
    test("maps legacy/synonyms", () => {
      expect(normalizeTicketStatus("doing")).toBe("in_progress");
      expect(normalizeTicketStatus("inprogress")).toBe("in_progress");
      expect(normalizeTicketStatus("in_progress")).toBe("in_progress");

      expect(normalizeTicketStatus("backlog")).toBe("backlog");
      expect(normalizeTicketStatus("todo")).toBe("todo");
      expect(normalizeTicketStatus("to-do")).toBe("todo");
      expect(normalizeTicketStatus("to_do")).toBe("todo");

      expect(normalizeTicketStatus("done")).toBe("done");
      expect(normalizeTicketStatus("complete")).toBe("done");
      expect(normalizeTicketStatus("completed")).toBe("done");

      expect(normalizeTicketStatus("canceled")).toBe("canceled");
      expect(normalizeTicketStatus("cancelled")).toBe("canceled");
      expect(normalizeTicketStatus("wont_do")).toBe("canceled");
      expect(normalizeTicketStatus("won't do")).toBe("canceled");
    });

    test("defaults to todo for unknown", () => {
      expect(normalizeTicketStatus("whatever")).toBe("todo");
    });
  });

  describe("extractHubActions", () => {
    test("extracts set_ticket_state and trims fields", () => {
      const out = `hello\n\n\`\`\`hub-action\n{"kind":"set_ticket_state","status":"  done ","note":"  ok "}\n\`\`\`\n`;
      expect(extractHubActions(out)).toEqual([{ kind: "set_ticket_state", status: "done", note: "ok" }]);
    });

    test("extracts collab.assign and filters invalid items", () => {
      const out = `\`\`\`hub-action\n{"kind":"collab.assign","assign":[{"agentId":" dev ","task":" fix "},{"agentId":"","task":"nope"},{"task":"missing"}]}\n\`\`\``;
      expect(extractHubActions(out)).toEqual([
        { kind: "collab.assign", assign: [{ agentId: "dev", task: "fix" }] },
      ]);
    });

    test("ignores invalid JSON blocks", () => {
      const out = `\`\`\`hub-action\n{not json}\n\`\`\``;
      expect(extractHubActions(out)).toEqual([]);
    });

    test("handles multiple action blocks", () => {
      const out = `a\n\n\`\`\`hub-action\n{"kind":"set_ticket_state","status":"todo"}\n\`\`\`\n\n\`\`\`hub-action\n{"kind":"collab.assign","assign":[{"agentId":"ops","task":"check"}]}\n\`\`\``;
      expect(extractHubActions(out)).toEqual([
        { kind: "set_ticket_state", status: "todo" },
        { kind: "collab.assign", assign: [{ agentId: "ops", task: "check" }] },
      ]);
    });
  });

  describe("isStuckTicket", () => {
    test("returns false for non-in-progress tickets", () => {
      expect(
        isStuckTicket(
          {
            status: "todo",
            dispatchState: "idle",
            updatedAt: new Date(0),
            lastDispatchedAt: null,
          },
          1000,
          10_000
        )
      ).toBe(false);
    });

    test("returns false when dispatchState is running/needs_input", () => {
      for (const dispatchState of ["running", "needs_input"]) {
        expect(
          isStuckTicket(
            {
              status: "in_progress",
              dispatchState,
              updatedAt: new Date(0),
              lastDispatchedAt: null,
            },
            1000,
            10_000
          )
        ).toBe(false);
      }
    });

    test("uses lastDispatchedAt when present", () => {
      // updatedAt is old enough, but lastDispatchedAt is recent: should not be stuck
      expect(
        isStuckTicket(
          {
            status: "in_progress",
            dispatchState: "idle",
            updatedAt: new Date(0),
            lastDispatchedAt: new Date(9_500),
          },
          1000,
          10_000
        )
      ).toBe(false);

      // now sufficiently past lastDispatchedAt: stuck
      expect(
        isStuckTicket(
          {
            status: "in_progress",
            dispatchState: "idle",
            updatedAt: new Date(0),
            lastDispatchedAt: new Date(8_000),
          },
          1000,
          10_000
        )
      ).toBe(true);
    });

    test("falls back to updatedAt when lastDispatchedAt is null", () => {
      expect(
        isStuckTicket(
          {
            status: "doing",
            dispatchState: "error",
            updatedAt: new Date(9_500),
            lastDispatchedAt: null,
          },
          1000,
          10_000
        )
      ).toBe(false);

      expect(
        isStuckTicket(
          {
            status: "doing",
            dispatchState: "error",
            updatedAt: new Date(8_000),
            lastDispatchedAt: null,
          },
          1000,
          10_000
        )
      ).toBe(true);
    });
  });
});

import { auditEvents } from "@/db/schema";
import { db } from "@/lib/db";

export async function logAuditEvent(input: {
  workspaceId: string;
  eventType: string;
  actorUserId?: string;
  agentId?: string;
  providerKey?: string;
  correlationId?: string;
  result: "success" | "failure";
  details?: Record<string, unknown>;
}): Promise<void> {
  // Auditing should never break product flows.
  try {
    await db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      correlationId: input.correlationId,
      eventType: input.eventType,
      actorUserId: input.actorUserId,
      agentId: input.agentId,
      providerKey: input.providerKey,
      result: input.result,
      details: input.details ?? {}
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("Failed to write audit event", { err, eventType: input.eventType });
  }
}

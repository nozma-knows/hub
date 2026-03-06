import { auditEvents } from "@/db/schema";
import { db } from "@/lib/db";

export async function logAuditEvent(input: {
  eventType: string;
  actorUserId?: string;
  agentId?: string;
  providerKey?: string;
  result: "success" | "failure";
  details?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(auditEvents).values({
    eventType: input.eventType,
    actorUserId: input.actorUserId,
    agentId: input.agentId,
    providerKey: input.providerKey,
    result: input.result,
    details: input.details ?? {}
  });
}

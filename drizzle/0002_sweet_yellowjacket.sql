ALTER TABLE "agent_invocations" DROP CONSTRAINT "agent_invocations_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_invocations" ADD CONSTRAINT "agent_invocations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
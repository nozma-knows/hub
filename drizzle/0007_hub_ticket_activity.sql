CREATE TABLE IF NOT EXISTS "hub_ticket_comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "ticket_id" uuid NOT NULL,
  "author_type" varchar(16) DEFAULT 'human' NOT NULL,
  "author_user_id" text,
  "author_agent_id" text,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hub_ticket_invocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "ticket_id" uuid NOT NULL,
  "invocation_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_ticket_comments" ADD CONSTRAINT "hub_ticket_comments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_ticket_comments" ADD CONSTRAINT "hub_ticket_comments_ticket_id_hub_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."hub_tickets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_ticket_invocations" ADD CONSTRAINT "hub_ticket_invocations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_ticket_invocations" ADD CONSTRAINT "hub_ticket_invocations_ticket_id_hub_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."hub_tickets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_ticket_invocations" ADD CONSTRAINT "hub_ticket_invocations_invocation_id_agent_invocations_id_fk" FOREIGN KEY ("invocation_id") REFERENCES "public"."agent_invocations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

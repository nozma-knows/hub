ALTER TABLE "agents" ADD COLUMN "model" varchar(160);--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "upstream_workspace_path" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "upstream_agent_dir" text;
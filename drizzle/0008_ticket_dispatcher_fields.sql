ALTER TABLE "hub_tickets" ADD COLUMN "dispatch_state" varchar(16) DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "hub_tickets" ADD COLUMN "dispatch_lock_id" uuid;--> statement-breakpoint
ALTER TABLE "hub_tickets" ADD COLUMN "dispatch_lock_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hub_tickets" ADD COLUMN "last_dispatched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hub_tickets" ADD COLUMN "last_dispatch_error" text;
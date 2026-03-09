DO $$ BEGIN
  ALTER TABLE "hub_tickets" ADD COLUMN IF NOT EXISTS "dispatch_state" varchar(16) DEFAULT 'idle' NOT NULL;
EXCEPTION WHEN duplicate_column THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "hub_tickets" ADD COLUMN IF NOT EXISTS "dispatch_lock_id" uuid;
EXCEPTION WHEN duplicate_column THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "hub_tickets" ADD COLUMN IF NOT EXISTS "dispatch_lock_expires_at" timestamp with time zone;
EXCEPTION WHEN duplicate_column THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "hub_tickets" ADD COLUMN IF NOT EXISTS "last_dispatched_at" timestamp with time zone;
EXCEPTION WHEN duplicate_column THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "hub_tickets" ADD COLUMN IF NOT EXISTS "last_dispatch_error" text;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

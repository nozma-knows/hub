CREATE TABLE IF NOT EXISTS "hub_dispatcher_state" (
  "key" varchar(32) PRIMARY KEY NOT NULL,
  "last_tick_at" timestamp with time zone,
  "last_error" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

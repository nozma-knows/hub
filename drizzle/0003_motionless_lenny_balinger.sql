CREATE TABLE "tool_provider_app_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"encrypted_client_id" text NOT NULL,
	"encrypted_client_secret" text NOT NULL,
	"scopes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tool_provider_app_credentials" ADD CONSTRAINT "tool_provider_app_credentials_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_provider_app_credentials" ADD CONSTRAINT "tool_provider_app_credentials_provider_id_tool_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."tool_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_provider_app_credentials" ADD CONSTRAINT "tool_provider_app_credentials_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tool_provider_app_creds_workspace_provider_unique" ON "tool_provider_app_credentials" USING btree ("workspace_id","provider_id");
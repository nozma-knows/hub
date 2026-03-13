import { relations, sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  bigint
} from "drizzle-orm/pg-core";

export const users = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});
export const user = users;

export const sessions = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
});
export const session = sessions;

export const accounts = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});
export const account = accounts;

export const verifications = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});

// BetterAuth's Drizzle adapter resolves this model by the singular key.
export const verification = verifications;

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 160 }).notNull(),
  slug: varchar("slug", { length: 120 }).notNull().unique(),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).notNull().default("operator"),
    invitedBy: text("invited_by").references(() => users.id, { onDelete: "set null" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.userId] })
  })
);

export const workspaceInvites = pgTable("workspace_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 320 }).notNull(),
  role: varchar("role", { length: 20 }).notNull().default("operator"),
  tokenHash: text("token_hash").notNull().unique(),
  invitedBy: text("invited_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  acceptedBy: text("accepted_by").references(() => users.id, { onDelete: "set null" }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const hubChannels = pgTable("hub_channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 80 }).notNull(),
  description: text("description"),

  kind: varchar("kind", { length: 16 }).notNull().default("public"),
  dmOwnerUserId: text("dm_owner_user_id"),
  dmTargetAgentId: text("dm_target_agent_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const hubChannelAgents = pgTable("hub_channel_agents", {
  channelId: uuid("channel_id")
    .notNull()
    .references(() => hubChannels.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const hubThreads = pgTable("hub_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  channelId: uuid("channel_id")
    .notNull()
    .references(() => hubChannels.id, { onDelete: "cascade" }),
  title: text("title"),
  status: varchar("status", { length: 24 }).notNull().default("open"),
  createdByUserId: text("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow()
});

export const hubMessages = pgTable("hub_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  threadId: uuid("thread_id")
    .notNull()
    .references(() => hubThreads.id, { onDelete: "cascade" }),
  authorType: varchar("author_type", { length: 16 }).notNull().default("human"),
  authorUserId: text("author_user_id"),
  authorAgentId: text("author_agent_id"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const hubTickets = pgTable("hub_tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),

  // Human-friendly key (HUB-123)
  ticketNumber: bigint("ticket_number", { mode: "number" })
    .notNull()
    .default(sql`nextval('hub_ticket_number_seq')`),

  title: text("title").notNull(),
  description: text("description"),
  status: varchar("status", { length: 16 }).notNull().default("todo"),
  priority: varchar("priority", { length: 16 }).notNull().default("normal"),
  ownerAgentId: text("owner_agent_id"),
  createdByUserId: text("created_by_user_id"),

  // Dispatcher fields
  dispatchState: varchar("dispatch_state", { length: 16 }).notNull().default("idle"),
  dispatchLockId: uuid("dispatch_lock_id"),
  dispatchLockExpiresAt: timestamp("dispatch_lock_expires_at", { withTimezone: true }),
  lastDispatchedAt: timestamp("last_dispatched_at", { withTimezone: true }),
  lastDispatchError: text("last_dispatch_error"),

  // FSM (XState) for professional ticket lifecycle + needs_input handshake
  fsmState: jsonb("fsm_state"),
  pendingQuestion: jsonb("pending_question"),

  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedByUserId: text("deleted_by_user_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const hubMessageAttachments = pgTable("hub_message_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  messageId: uuid("message_id").references(() => hubMessages.id, { onDelete: "cascade" }),
  createdByUserId: text("created_by_user_id"),

  kind: varchar("kind", { length: 16 }).notNull().default("image"),
  storagePath: text("storage_path").notNull(),
  originalName: text("original_name"),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  width: integer("width"),
  height: integer("height"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const hubThreadTickets = pgTable("hub_thread_tickets", {
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  threadId: uuid("thread_id")
    .notNull()
    .references(() => hubThreads.id, { onDelete: "cascade" }),
  ticketId: uuid("ticket_id")
    .notNull()
    .references(() => hubTickets.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const hubTicketComments = pgTable("hub_ticket_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  ticketId: uuid("ticket_id")
    .notNull()
    .references(() => hubTickets.id, { onDelete: "cascade" }),
  authorType: varchar("author_type", { length: 16 }).notNull().default("human"),
  authorUserId: text("author_user_id"),
  authorAgentId: text("author_agent_id"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const hubDispatcherState = pgTable("hub_dispatcher_state", {
  key: varchar("key", { length: 32 }).primaryKey(),
  lastTickAt: timestamp("last_tick_at", { withTimezone: true }),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const hubTicketInvocations = pgTable("hub_ticket_invocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  ticketId: uuid("ticket_id")
    .notNull()
    .references(() => hubTickets.id, { onDelete: "cascade" }),
  invocationId: uuid("invocation_id")
    .notNull()
    .references(() => agentInvocations.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const hubTicketRuns = pgTable("hub_ticket_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  ticketId: uuid("ticket_id")
    .notNull()
    .references(() => hubTickets.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default("owner"),
  agentId: text("agent_id").notNull(),
  status: text("status").notNull().default("started"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  durationMs: integer("duration_ms"),
  error: text("error"),
  output: text("output")
});

export const hubSkillInstalls = pgTable("hub_skill_installs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),

  source: varchar("source", { length: 16 }).notNull().default("clawhub"),
  clawhubSkillId: text("clawhub_skill_id").notNull(),
  name: text("name"),
  author: text("author"),
  version: text("version"),

  // Normalized to allow a plain unique index (no expression) for onConflict targets.
  versionKey: text("version_key").notNull().default(""),

  installSpec: text("install_spec"),

  // Status lifecycle: queued -> installing -> installed | failed
  status: varchar("status", { length: 16 }).notNull().default("queued"),
  statusDetail: text("status_detail"),
  progress: integer("progress").notNull().default(0),

  error: text("error"),
  logs: text("logs"),

  // Background worker locking / retries
  installStartedAt: timestamp("install_started_at", { withTimezone: true }),
  installedAt: timestamp("installed_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  lockId: uuid("lock_id"),
  lockExpiresAt: timestamp("lock_expires_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),

  // Observability (best-effort)
  lastExitCode: integer("last_exit_code"),
  lastDurationMs: integer("last_duration_ms"),
  lastRateLimitRetryAfterMs: integer("last_rate_limit_retry_after_ms"),

  createdByUserId: text("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const hubAgentSkillPermissions = pgTable(
  "hub_agent_skill_permissions",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    clawhubSkillId: text("clawhub_skill_id").notNull(),
    isAllowed: boolean("is_allowed").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.agentId, table.clawhubSkillId] })
  })
);

export const agents = pgTable("agents", {
  id: text("id").primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  status: varchar("status", { length: 40 }).notNull().default("unknown"),
  openclawVersion: varchar("openclaw_version", { length: 80 }),
  model: varchar("model", { length: 160 }),
  description: text("description"),
  upstreamWorkspacePath: text("upstream_workspace_path"),
  upstreamAgentDir: text("upstream_agent_dir"),
  behaviorChecksum: varchar("behavior_checksum", { length: 80 }),
  isRemoved: boolean("is_removed").notNull().default(false),
  removedAt: timestamp("removed_at", { withTimezone: true }),
  lastSeenUpstreamAt: timestamp("last_seen_upstream_at", { withTimezone: true }),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const agentBehaviorConfigs = pgTable(
  "agent_behavior_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    model: varchar("model", { length: 120 }).notNull(),
    instructions: text("instructions").notNull(),
    runtimeConfig: jsonb("runtime_config").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    isActive: boolean("is_active").notNull().default(false),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    byAgentVersion: uniqueIndex("agent_behavior_version_unique").on(table.agentId, table.version)
  })
);

export const toolProviders = pgTable("tool_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: varchar("key", { length: 60 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  authType: varchar("auth_type", { length: 40 }).notNull(),
  capabilitiesSchema: jsonb("capabilities_schema").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

// OAuth app credentials (client_id/client_secret) for tool providers, encrypted at rest.
export const toolProviderAppCredentials = pgTable(
  "tool_provider_app_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => toolProviders.id, { onDelete: "cascade" }),
    encryptedClientId: text("encrypted_client_id").notNull(),
    encryptedClientSecret: text("encrypted_client_secret").notNull(),
    scopes: text("scopes").array().notNull().default(sql`ARRAY[]::text[]`),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    byWorkspaceProvider: uniqueIndex("tool_provider_app_creds_workspace_provider_unique").on(
      table.workspaceId,
      table.providerId
    )
  })
);

export const toolConnections = pgTable(
  "tool_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => toolProviders.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    encryptedAccessToken: text("encrypted_access_token").notNull(),
    encryptedRefreshToken: text("encrypted_refresh_token"),
    scopes: text("scopes").array().notNull().default(sql`ARRAY[]::text[]`),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    externalAccountId: text("external_account_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    byProviderWorkspaceUser: uniqueIndex("tool_connection_provider_workspace_user_unique").on(
      table.providerId,
      table.workspaceId,
      table.userId
    )
  })
);

export const agentToolPermissions = pgTable(
  "agent_tool_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => toolProviders.id, { onDelete: "cascade" }),
    isAllowed: boolean("is_allowed").notNull().default(false),
    scopeOverrides: jsonb("scope_overrides")
      .$type<{ capabilities?: string[]; constraints?: Record<string, unknown> }>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    byWorkspaceAgentProvider: uniqueIndex("agent_workspace_provider_permission_unique").on(
      table.workspaceId,
      table.agentId,
      table.providerId
    )
  })
);

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  correlationId: varchar("correlation_id", { length: 120 }),
  eventType: varchar("event_type", { length: 80 }).notNull(),
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
  providerKey: varchar("provider_key", { length: 60 }),
  result: varchar("result", { length: 20 }).notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const oauthStates = pgTable(
  "oauth_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    providerKey: varchar("provider_key", { length: 60 }).notNull(),
    state: varchar("state", { length: 120 }).notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    codeVerifier: text("code_verifier"),
    redirectPath: text("redirect_path").notNull().default("/integrations"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    byState: uniqueIndex("oauth_state_unique").on(table.workspaceId, table.state)
  })
);

export const modelProviderCredentials = pgTable(
  "model_provider_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    providerKey: varchar("provider_key", { length: 60 }).notNull(),
    encryptedApiKey: text("encrypted_api_key").notNull(),
    label: varchar("label", { length: 120 }).notNull().default("default"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    byWorkspaceProviderLabel: uniqueIndex("model_credential_workspace_provider_label_unique").on(
      table.workspaceId,
      table.providerKey,
      table.label
    )
  })
);

export const modelCatalogCache = pgTable(
  "model_catalog_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    providerKey: varchar("provider_key", { length: 60 }).notNull(),
    models: jsonb("models").$type<Array<{ id: string; name?: string; contextWindow?: number }>>().notNull().default(sql`'[]'::jsonb`),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    byWorkspaceProvider: uniqueIndex("model_catalog_workspace_provider_unique").on(
      table.workspaceId,
      table.providerKey
    )
  })
);

export const agentInvocations = pgTable("agent_invocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  correlationId: varchar("correlation_id", { length: 120 }).notNull(),
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  agentId: text("agent_id")
    .notNull()
    .references(() => agents.id),
  model: varchar("model", { length: 120 }),
  promptHash: varchar("prompt_hash", { length: 80 }),
  outputHash: varchar("output_hash", { length: 80 }),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  totalTokens: integer("total_tokens"),
  durationMs: integer("duration_ms"),
  result: varchar("result", { length: 20 }).notNull(),
  errorClass: varchar("error_class", { length: 120 }),
  usageRaw: jsonb("usage_raw").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  requestMeta: jsonb("request_meta").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const providersRelations = relations(toolProviders, ({ many }) => ({
  connections: many(toolConnections),
  permissions: many(agentToolPermissions),
  appCredentials: many(toolProviderAppCredentials)
}));

export const agentRelations = relations(agents, ({ many }) => ({
  behaviorConfigs: many(agentBehaviorConfigs),
  permissions: many(agentToolPermissions)
}));

export const connectionRelations = relations(toolConnections, ({ one }) => ({
  provider: one(toolProviders, {
    fields: [toolConnections.providerId],
    references: [toolProviders.id]
  }),
  user: one(users, {
    fields: [toolConnections.userId],
    references: [users.id]
  })
}));

export const permissionRelations = relations(agentToolPermissions, ({ one }) => ({
  agent: one(agents, {
    fields: [agentToolPermissions.agentId],
    references: [agents.id]
  }),
  provider: one(toolProviders, {
    fields: [agentToolPermissions.providerId],
    references: [toolProviders.id]
  })
}));

export const providerAppCredentialRelations = relations(toolProviderAppCredentials, ({ one }) => ({
  provider: one(toolProviders, {
    fields: [toolProviderAppCredentials.providerId],
    references: [toolProviders.id]
  }),
  workspace: one(workspaces, {
    fields: [toolProviderAppCredentials.workspaceId],
    references: [workspaces.id]
  }),
  updatedByUser: one(users, {
    fields: [toolProviderAppCredentials.updatedBy],
    references: [users.id]
  })
}));

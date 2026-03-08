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
  varchar
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

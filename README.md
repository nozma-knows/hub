# OpenClaw Hub

A Bun-first control plane for OpenClaw agents with per-agent tool access governance.

## Stack

- `Next.js` App Router for web app framework
- `Hono` mounted under `app/api/[[...route]]` for API hosting
- `tRPC` for typed procedures
- `Postgres + Drizzle` for durable state
- `BetterAuth` for authentication/session
- `Tailwind + shadcn-style UI components`

## What this implements

- Agent CRUD routed through OpenClaw (OpenClaw is source of truth)
- Local mirrored agent table + behavior config history
- Workspace-based multi-user collaboration with invite flow and roles (`owner/admin/operator`)
- Provider plugin system with Slack + Linear implementations
- OAuth connect/disconnect callbacks via Hono
- Per-agent allow/deny matrix for provider access
- Policy-gated agent invoke path that injects only allowed provider credentials
- Audit event trail for security-sensitive mutations
- Per-invoke usage ledger (token and latency metadata)
- Model credential store + model catalog fetch (OpenAI/Anthropic)
- Scheduled reconciliation sync from OpenClaw to local mirror

## Bun runtime

This project is configured for Bun runtime/tooling:

- `packageManager`: `bun@1.2.16`
- scripts use `bunx --bun` where relevant

### Install

```bash
bun install
```

### Run locally

```bash
cp .env.example .env
bun run db:up
bun run db:generate
bun run db:migrate
bun run dev
```

### Local Postgres (Docker)

```bash
bun run db:up
```

Default host port is `55432` to avoid collisions with existing local Postgres instances.

Useful DB lifecycle commands:

```bash
bun run db:logs
bun run db:down
```

If `db:migrate` errors with `url: ''`, your `.env` is missing `DATABASE_URL` or wasn’t created yet.

### Build / typecheck

```bash
bun run check
bun run build
```

### OpenClaw connectivity check

```bash
bun run openclaw:check
```

Use this after changing `OPENCLAW_BASE_URL`/`OPENCLAW_API_KEY` to confirm the Hub can reach your gateway.

## Required environment variables

Copy `.env.example` and fill these with real values:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `HUB_ENCRYPTION_KEY`
- `OPENCLAW_BASE_URL`
- `OPENCLAW_API_KEY`
- `OPENAI_API_KEY` (optional, for model catalog seeding)
- `ANTHROPIC_API_KEY` (optional, for model catalog seeding)
- `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`
- `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

## OAuth redirect URLs

Set these redirect URIs in provider dashboards:

- Slack: `http://localhost:3000/api/oauth/slack/callback`
- Linear: `http://localhost:3000/api/oauth/linear/callback`
- Google (BetterAuth sign-in): `http://localhost:3000/api/auth/callback/google`

## Google Auth setup

Create an OAuth 2.0 Web App in Google Cloud and configure:

- Authorized JavaScript origins: `http://localhost:3000`
- Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`

Then set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`.

For production, replace `http://localhost:3000` with your deployed origin.

## Core routes

- Hono health: `GET /api/health`
- tRPC endpoint: `/api/trpc/*`
- BetterAuth route: `/api/auth/[...all]`
- Provider callbacks:
- `/api/oauth/slack/callback`
- `/api/oauth/linear/callback`

## Multi-user workflow

1. Sign in as workspace owner/admin.
2. Open `/workspace` and create an invite token for your collaborator.
3. Collaborator signs in and opens `/workspace/invite?token=<token>`.
4. Both users now interact with shared agents, access matrix, integrations, usage, and audit logs.

## Extending providers

Add a new tool provider by:

1. Implementing `ToolProvider` in `src/lib/providers/`.
2. Registering it in `src/lib/providers/registry.ts`.
3. Seeding provider metadata (`ensureProviderSeeds`).
4. Granting per-agent access via the Access Matrix UI.

No core router redesign is required when adding a provider that follows the interface.

## OpenClaw integration notes

`src/lib/openclaw/adapter.ts` implements:

- SDK-first loading (`OPENCLAW_SDK_PACKAGE`), with REST fallback
- REST endpoint compatibility fallback (`/agents`, `/api/agents`, `/v1/agents`, control variants)
- Idempotency keys for writes
- retry with bounded backoff
- circuit-breaker protection
- behavior validation before create/update

## Recommended OpenClaw connection (local)

Use the OpenClaw gateway HTTP origin for `OPENCLAW_BASE_URL` (not the websocket URL).

- If your gateway is exposed as `ws://localhost:18789`, set:
- `OPENCLAW_BASE_URL=http://localhost:18789`
- `OPENCLAW_API_KEY=<gateway token>`

Quick connectivity check:

```bash
curl -i http://localhost:18789/health
```

If that fails, start/restart the OpenClaw gateway first. The hub can only sync existing agents while the gateway is running.

## Production setup: Tailscale Serve (private HTTPS)

This is the recommended low-ops setup for a small private deployment.

1. Put both machines on the same tailnet:
   - OpenClaw host
   - Hub host
2. Keep OpenClaw bound to localhost on its host (`127.0.0.1:18789`).
3. On the OpenClaw host, publish that local port via Tailscale Serve over HTTPS.
4. On the Hub host, set:
   - `OPENCLAW_BASE_URL=https://<openclaw-hostname>.<tailnet>.ts.net`
   - `OPENCLAW_API_KEY=<gateway token>`
5. From this repo, verify connectivity:
   - `bun run openclaw:check`
6. Start the Hub and sync:
   - `bun run dev`
   - Open `/agents` and click `Sync from OpenClaw`.

Notes:
- Keep the OpenClaw process private; do not expose it directly on the public internet.
- Use `tailscale serve --help` on your OpenClaw host for the exact command syntax for your installed Tailscale version.

## Important current defaults

- App is single-operator friendly but schema is multi-user compatible.
- Tokens are encrypted at rest before DB persistence.
- Placeholder env defaults exist only to allow build-time analysis; production must provide real values.

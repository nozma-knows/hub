# OpenClaw Hub — Agent Guide

This is the **operating manual** for agents working with **OpenClaw Hub**.

## What Hub Is

Hub is the **control plane** for an OpenClaw deployment.

Hub’s goals:
- Be the **source of truth** for:
  - **Messages** (Hub-native channels + timelines)
  - **Tickets** (Hub-native Kanban: Todo / Doing / Done)
- Provide a UI to:
  - manage agents and their workspace files
  - configure tool integrations (Slack/Linear later)
  - run agents on tickets and keep an audit trail

Hub runs on the same host as OpenClaw so it can safely access:
- the OpenClaw CLI (`openclaw ...`)
- the OpenClaw workspace files (`~/.openclaw/**`)

## How Hub Is Built

Stack summary:
- Next.js (App Router)
- API under `/api` (Hono)
- tRPC for typed client/server calls
- Postgres + Drizzle ORM
- BetterAuth for authentication

Where things live:
- Repo root (on VPS): `/root/.openclaw/workspace/hub`
- UI pages: `src/app/**` and `src/components/pages/**`
- tRPC routers: `src/server/trpc/routers/**`
- DB schema: `src/db/schema.ts`
- Migrations: `drizzle/*.sql`
- OpenClaw CLI adapter: `src/lib/openclaw/cli-adapter.ts`

Convenience:
- Each agent workspace has a symlink `./hub` → `/root/.openclaw/workspace/hub`
  so agents can inspect the repo from their own workspace context.

## Key Product Model

### Messages
- Channels: Hub-native channels (like Slack channels)
- Threads: currently per-channel timeline is implemented using the newest thread
- Messages: items authored by humans/agents/system

Routes:
- `/messages` → channel list
- `/messages/[channelId]` → channel timeline + composer

### Tickets
- Kanban: `/tickets` with Todo/Doing/Done
- Ticket detail modal: comments + run owner agent

## How Agents Should Work With Hub

Agents should treat Hub as:
- the place where humans will communicate
- the place where tasks/tickets live
- the place where work should be tracked and updated

### Operating Rules

1) **Only act when invoked**
   - In messages: respond when a message includes `@command` (CoS)
   - In tickets: work items are explicit; don’t create noise

2) **Prefer tickets for actionable work**
   - If something requires more than a quick reply, create (or request creation of) a ticket.

3) **Be explicit about next steps**
   - Always return: what you did, what changed, next steps, blockers.

4) **Safe changes on the VPS**
   - Prefer small diffs.
   - Prefer reversible changes.
   - Log decisions in tickets.

## How To Maintain/Update Hub

### Deploy process (on the VPS)
- Code lives under: `/root/.openclaw/workspace/hub`
- Typical deployment:
  1) `git pull`
  2) `bun run db:migrate`
  3) `bun run build`
  4) `systemctl restart openclaw-hub`

### Common troubleshooting

- If Hub pages behave inconsistently after deploy on mobile:
  - iOS Safari may cache aggressively.
  - Users may need to hard refresh.

- If OpenClaw CLI calls fail under systemd:
  - ensure `HOME` is set in the service environment

- If you see OpenClaw HTTP 405:
  - do **not** use the OpenClaw HTTP adapter for control-plane operations.
  - use the OpenClaw CLI adapter instead.

## How To Interact With OpenClaw

Prefer CLI for stability in this deployment:
- list agents: `openclaw agents list`
- create agent: `openclaw agents add ...`
- set identity: `openclaw agents set-identity ...`
- delete agent: `openclaw agents delete <id> --force`
- agent turn (no delivery): `openclaw agent --agent <id> --message "..." --json`

## Current Collaboration Setup

Agents:
- `cos` (Command) — Chief of Staff / triage + delegation
- `ops` — reliability
- `dev` — engineering
- `pm` — planning
- `research` — sourcing

Channels:
- `#general`, `#ops`, `#dev`, `#product`, `#research`


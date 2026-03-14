# Hub Deployment (single VPS)

This repo is deployed on a single VPS with:
- Hub web (Next.js) as a systemd service
- Hub dispatcher worker as a separate systemd service
- Postgres in Docker (bound to localhost)
- OpenClaw gateway running locally (loopback) with optional reverse-proxy

## Services

### Hub Web
- Service: `openclaw-hub.service`
- Working dir: `/root/.openclaw/workspace/hub`
- Env file: `/root/.openclaw/workspace/hub/.env`

Recommended: bind web to loopback only (no direct public exposure):
- `next start -H 127.0.0.1 -p 3000`

### Hub Dispatcher Worker
- Service: `openclaw-hub-dispatcher.service`
- Runs: `bun run dispatcher`

## Postgres (Docker)

- Compose: `docker-compose.yml`
- Host port: `127.0.0.1:55432` (loopback bound)

Commands:
- `bun run db:up`
- `bun run db:logs`
- `bun run db:migrate`

## Deploy steps (typical)

From `/root/.openclaw/workspace/hub`:

1. Update code
   - `git pull`

2. Verify env (fail-closed in prod)
   - `bun run env:check`

3. Migrate
   - `bun run db:migrate`

4. Typecheck + tests
   - `bun run check`
   - `bun test`

5. Restart services
   - `systemctl restart openclaw-hub`
   - `systemctl restart openclaw-hub-dispatcher`

## Rollback

- `git log --oneline -n 20`
- `git reset --hard <known-good-sha>`
- Restart services.

## Backup (minimal)

At minimum back up:
- Postgres volume (or run logical dumps)
- `/root/.openclaw/workspace/hub/.env`

Example logical dump:
- `pg_dump "$DATABASE_URL" > hub.sql`

## Notes

- If you scale to multiple web instances in the future, disable background loops in the web process:
  - `HUB_SYNC_ENABLED=false`
  - `HUB_MEDIA_GC_ENABLED=false`
  and run them in dedicated worker(s).

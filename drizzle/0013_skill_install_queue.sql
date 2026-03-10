-- Add queue/locking fields for background skill installs.

ALTER TABLE hub_skill_installs
  ADD COLUMN IF NOT EXISTS version_key text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS status_detail text,
  ADD COLUMN IF NOT EXISTS progress integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS install_started_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS finished_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS lock_id uuid,
  ADD COLUMN IF NOT EXISTS lock_expires_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

-- Replace expression-based unique index with a simple one we can target from Drizzle.
DROP INDEX IF EXISTS hub_skill_installs_unique_skill;
CREATE UNIQUE INDEX IF NOT EXISTS hub_skill_installs_unique_skill_v2
  ON hub_skill_installs(workspace_id, source, clawhub_skill_id, version_key);

CREATE INDEX IF NOT EXISTS hub_skill_installs_status_idx ON hub_skill_installs(workspace_id, status);

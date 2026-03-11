-- Add runtime/progress fields needed by skill installer worker.

ALTER TABLE hub_skill_installs
  ADD COLUMN IF NOT EXISTS version_key text NOT NULL DEFAULT '';

ALTER TABLE hub_skill_installs
  ADD COLUMN IF NOT EXISTS status_detail text,
  ADD COLUMN IF NOT EXISTS progress integer,
  ADD COLUMN IF NOT EXISTS lock_id uuid,
  ADD COLUMN IF NOT EXISTS lock_expires_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS install_started_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS finished_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS hub_skill_installs_lock_idx ON hub_skill_installs(lock_expires_at);

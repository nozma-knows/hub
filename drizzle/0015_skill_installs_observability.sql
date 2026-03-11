-- Add observability fields for clawhub installs (exit code, duration, rate limit hints)

ALTER TABLE hub_skill_installs
  ADD COLUMN IF NOT EXISTS last_exit_code integer,
  ADD COLUMN IF NOT EXISTS last_duration_ms integer,
  ADD COLUMN IF NOT EXISTS last_rate_limit_retry_after_ms integer;

-- DM channels: private per-user direct threads to an agent (e.g., Command).

ALTER TABLE hub_channels
  ADD COLUMN IF NOT EXISTS kind varchar(16) NOT NULL DEFAULT 'public';

ALTER TABLE hub_channels
  ADD COLUMN IF NOT EXISTS dm_owner_user_id text;

ALTER TABLE hub_channels
  ADD COLUMN IF NOT EXISTS dm_target_agent_id text;

CREATE INDEX IF NOT EXISTS hub_channels_kind_idx ON hub_channels(workspace_id, kind);
CREATE INDEX IF NOT EXISTS hub_channels_dm_owner_idx ON hub_channels(workspace_id, dm_owner_user_id);

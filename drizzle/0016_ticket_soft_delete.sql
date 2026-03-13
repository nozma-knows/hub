-- Soft delete for tickets

ALTER TABLE hub_tickets
  ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS deleted_by_user_id text;

CREATE INDEX IF NOT EXISTS hub_tickets_deleted_idx ON hub_tickets(workspace_id, deleted_at);

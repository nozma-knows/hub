-- Message attachments (images) for Hub messaging.

CREATE TABLE IF NOT EXISTS hub_message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  message_id uuid REFERENCES hub_messages(id) ON DELETE CASCADE,
  created_by_user_id text,

  kind varchar(16) NOT NULL DEFAULT 'image',
  storage_path text NOT NULL,
  original_name text,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL,
  width integer,
  height integer,

  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hub_message_attachments_message_idx ON hub_message_attachments(workspace_id, message_id);
CREATE INDEX IF NOT EXISTS hub_message_attachments_workspace_idx ON hub_message_attachments(workspace_id, created_at);

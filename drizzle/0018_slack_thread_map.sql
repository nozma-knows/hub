-- Map Slack conversations (channel + thread_ts) to Hub threads

CREATE TABLE IF NOT EXISTS hub_slack_threads (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slack_team_id text NOT NULL,
  slack_channel_id text NOT NULL,
  slack_thread_ts text NOT NULL,
  hub_thread_id uuid NOT NULL REFERENCES hub_threads(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, slack_team_id, slack_channel_id, slack_thread_ts)
);

CREATE INDEX IF NOT EXISTS hub_slack_threads_thread_idx
  ON hub_slack_threads(workspace_id, hub_thread_id);

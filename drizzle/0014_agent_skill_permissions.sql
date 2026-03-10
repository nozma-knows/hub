-- Per-agent allow/deny for installed skills.

CREATE TABLE IF NOT EXISTS hub_agent_skill_permissions (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  clawhub_skill_id text NOT NULL,
  is_allowed boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, agent_id, clawhub_skill_id)
);

CREATE INDEX IF NOT EXISTS hub_agent_skill_permissions_agent_idx
  ON hub_agent_skill_permissions(workspace_id, agent_id);

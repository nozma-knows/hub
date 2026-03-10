-- Track Clawhub skill installs initiated from Hub.

CREATE TABLE IF NOT EXISTS hub_skill_installs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  source varchar(16) NOT NULL DEFAULT 'clawhub',
  clawhub_skill_id text NOT NULL,
  name text,
  author text,
  version text,
  install_spec text,

  status varchar(16) NOT NULL DEFAULT 'installing',
  error text,
  logs text,

  created_by_user_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  installed_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS hub_skill_installs_workspace_id_idx ON hub_skill_installs(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS hub_skill_installs_unique_skill ON hub_skill_installs(workspace_id, source, clawhub_skill_id, COALESCE(version, ''));

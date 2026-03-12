-- Ticket run timeline (Hub-native). Records each dispatcher invocation.

CREATE TABLE IF NOT EXISTS hub_ticket_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES hub_tickets(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'owner', -- owner | specialist | coordinator
  agent_id text NOT NULL,
  status text NOT NULL DEFAULT 'started', -- started | ok | error
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  finished_at timestamp with time zone,
  duration_ms integer,
  error text,
  output text
);

CREATE INDEX IF NOT EXISTS hub_ticket_runs_ticket_idx
  ON hub_ticket_runs(workspace_id, ticket_id, started_at);

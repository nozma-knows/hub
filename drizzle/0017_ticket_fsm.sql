-- Ticket FSM state (XState) + pending question fields

ALTER TABLE hub_tickets
  ADD COLUMN IF NOT EXISTS fsm_state jsonb,
  ADD COLUMN IF NOT EXISTS pending_question jsonb;

-- Add stable human-friendly ticket numbering.

DO $$ BEGIN
  CREATE SEQUENCE IF NOT EXISTS hub_ticket_number_seq;
EXCEPTION WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE hub_tickets ADD COLUMN IF NOT EXISTS ticket_number bigint;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

-- Backfill existing rows.
UPDATE hub_tickets
SET ticket_number = nextval('hub_ticket_number_seq')
WHERE ticket_number IS NULL;

-- Default for new rows.
ALTER TABLE hub_tickets ALTER COLUMN ticket_number SET DEFAULT nextval('hub_ticket_number_seq');

-- Enforce not null + uniqueness.
ALTER TABLE hub_tickets ALTER COLUMN ticket_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS hub_tickets_ticket_number_uq ON hub_tickets(ticket_number);

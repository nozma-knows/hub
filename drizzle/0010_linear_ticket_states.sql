-- Align Hub ticket states with Linear-like workflow states.
-- Previous Hub states: todo / doing / done
-- New canonical states: backlog / todo / in_progress / done / canceled

UPDATE hub_tickets SET status = 'in_progress' WHERE status = 'doing';
UPDATE hub_tickets SET status = 'done' WHERE status = 'done';
UPDATE hub_tickets SET status = 'todo' WHERE status = 'todo';

-- Safety: any unknown legacy values get mapped to todo
UPDATE hub_tickets SET status = 'todo' WHERE status NOT IN ('backlog','todo','in_progress','done','canceled');

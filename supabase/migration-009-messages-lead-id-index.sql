-- Dashboard reads messages by lead_id (replies, last outbound). CONCURRENTLY keeps
-- the every-minute mirror writing while it builds; it cannot run inside a transaction.
create index concurrently if not exists messages_lead_id_idx on public.messages (lead_id);

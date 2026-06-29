-- Activity ordering: latest outbound ("our agent messaged them") timestamp per lead.
-- Read-only grouped view; one row per (practice_id, lead_id). Safe additive change.
create or replace view lead_last_outbound as
select
  practice_id,
  lead_id,
  max(created_at) as last_outbound_at
from messages
where direction = 'outbound'
  and lead_id is not null
group by practice_id, lead_id;

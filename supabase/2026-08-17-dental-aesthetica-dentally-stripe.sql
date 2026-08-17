-- Register Dental Aesthetica's Dentally and Stripe connections.
--
-- Both have been working for weeks: Poppy books consultations into Dentally and
-- takes the £30 refundable deposit through Stripe. Neither was ever recorded
-- here, so the Connections page told the practice both were missing.
--
-- Nothing about either is configured by these rows. The credentials live in n8n,
-- which is what actually talks to Dentally and Stripe; these exist so the page
-- can say what is running, and so the mirror has somewhere to record when each
-- last succeeded.
--
-- mode is 'native' rather than 'legacy_mirror' because neither is a copy of
-- another system's data: our own automation performs the booking and the charge.
--
-- Safe to run multiple times.

do $$
declare
  da_practice uuid;
begin
  select id into da_practice from practices where name = 'Dental Aesthetica';
  if da_practice is null then
    raise notice 'Dental Aesthetica practice not found; skipping.';
    return;
  end if;

  -- last_synced_at is deliberately left null. The mirror sets it from the real
  -- evidence on its next run: the most recent appointment booked, and the most
  -- recent deposit paid. Seeding it with now() would claim a success that has
  -- not happened.
  insert into integrations (practice_id, source_system, display_name, mode, status)
  values
    (da_practice, 'dentally', 'Dentally booking', 'native', 'connected'),
    (da_practice, 'stripe', 'Stripe deposits', 'native', 'connected')
  on conflict (practice_id, source_system) do update
     set display_name = excluded.display_name,
         mode = excluded.mode,
         updated_at = now();
end $$;

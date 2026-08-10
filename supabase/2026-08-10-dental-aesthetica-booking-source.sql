-- Tell the Leadflo mirror where Dental Aesthetica's bookings live.
--
-- Leadflo knows a patient enquired and the feeder knows they were messaged, but
-- neither knows whether the deposit turned into an appointment. That state is
-- written by the Stripe workflow into dental_aesthetica_leads, which sits in the
-- legacy Supabase project. Without this the mirror can never mark a lead booked,
-- so a patient with a confirmed slot still reads as "engaged".
--
-- As with the feeder key, no secret is stored here: settings names the
-- environment variables to read them from.
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

  update integrations
     set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
           'bookingSupabaseUrlEnv', 'REGENT_LEGACY_SUPABASE_URL',
           'bookingSupabaseServiceRoleKeyEnv', 'REGENT_LEGACY_SUPABASE_SERVICE_ROLE_KEY',
           'bookingTable', 'dental_aesthetica_leads'
         ),
         updated_at = now()
   where practice_id = da_practice
     and source_system = 'leadflo';

  if not found then
    raise notice 'Leadflo integration not registered yet; run the seed first.';
  end if;
end $$;

-- Register the Leadflo feeder as Dental Aesthetica's lead source.
--
-- Why: DA's leads only exist in the WF-1 feeder (scraped from Leadflo), so the
-- dashboard shows the practice with zero leads. The mirror in lib/leadflo-mirror.ts
-- reads this row to find the feeder, the same way the Boxly mirror reads its own
-- integration row.
--
-- The feeder key is NOT stored here. settings names the environment variable to
-- read it from, so the secret stays in the deployment config.
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

  insert into integrations (practice_id, source_system, display_name, mode, status, settings)
  values (
    da_practice,
    'leadflo',
    'Leadflo (WF-1 feeder)',
    'legacy_mirror',
    'draft',
    jsonb_build_object(
      'feederBaseUrl', 'https://dental-asthetica.wasup.co',
      'feederApiKeyEnv', 'LEADFLO_FEEDER_API_KEY'
    )
  )
  on conflict (practice_id, source_system) do update
    set display_name = excluded.display_name,
        mode = excluded.mode,
        settings = excluded.settings,
        updated_at = now();

  raise notice 'Leadflo integration registered for Dental Aesthetica (%).', da_practice;
end $$;

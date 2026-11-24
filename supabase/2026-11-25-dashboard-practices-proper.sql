-- Make the Wasup Dental practice list and its counts match reality.
--
-- 1. The review system's two practices ("Regent Dental" grs-test and "NUYU
--    Dental & Aesthetics" nuyu-test) are hidden from the dashboard switcher.
--    They are not deleted: the review workflows and NUYU's review patients
--    still live on them.
-- 2. Regent and Nuyu mark leads booked from the deposits the Stripe workflows
--    record in "dental-leads", in the same legacy project as their Boxly leads.
-- 3. Leigh Dental Centre gets its lead source: the Dengro leads n8n writes to
--    leigh_dental_leads.
--
-- No secret is stored here: settings name the environment variables to read.
--
-- Safe to run multiple times.

update practices
   set external_payload = coalesce(external_payload, '{}'::jsonb) || '{"dashboardHidden": true}'::jsonb,
       updated_at = now()
 where external_id in ('grs-test', 'nuyu-test');

update integrations i
   set settings = coalesce(i.settings, '{}'::jsonb) || '{"bookingTable": "dental-leads"}'::jsonb,
       updated_at = now()
  from practices p
 where p.id = i.practice_id
   and p.external_id in ('regent-boxly', 'nuyu-boxly')
   and i.source_system = 'boxly';

insert into integrations (practice_id, source_system, display_name, mode, status, settings)
select id, 'dengro', 'Dengro leads', 'native', 'connected',
       jsonb_build_object(
         'leadsTable', 'leigh_dental_leads',
         'supabaseUrlEnv', 'REGENT_LEGACY_SUPABASE_URL',
         'supabaseServiceRoleKeyEnv', 'REGENT_LEGACY_SUPABASE_SERVICE_ROLE_KEY'
       )
  from practices
 where external_id = 'leigh-dental-centre'
on conflict (practice_id, source_system) do update
   set settings = coalesce(integrations.settings, '{}'::jsonb) || excluded.settings,
       display_name = excluded.display_name,
       updated_at = now();

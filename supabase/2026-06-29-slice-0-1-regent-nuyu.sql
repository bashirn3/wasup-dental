-- Slice 0/1 seed for Regent and Nuyu workspaces.
-- Safe to run multiple times. It only writes to this app's Supabase project.
-- Replace client emails before production invites if they differ from Clerk login emails.

do $$
declare
  regent_org uuid;
  regent_practice uuid;
  nuyu_org uuid;
  nuyu_practice uuid;
  admin_email text;
  admin_emails text[] := array['bashir@tryrapidscreen.com', 'arslan@tryrapidscreen.com'];
  regent_client_email text := 'asif@smilefast.com';
  nuyu_client_email text := 'team@nuyu.example';
begin
  select id into regent_org from organizations where slug = 'regent';
  if regent_org is null then
    insert into organizations (name, slug) values ('Regent Dental', 'regent')
    returning id into regent_org;
  end if;

  select id into regent_practice from practices where external_id = 'regent-boxly';
  if regent_practice is null then
    insert into practices (
      organization_id, name, status, integration_mode, native_runtime_enabled,
      source_system, external_id, whatsapp_status, external_payload
    )
    values (
      regent_org, 'Regent Dental', 'review', 'legacy_mirror', false,
      'boxly', 'regent-boxly', 'connected', '{"seededFrom":"slice_0_1_seed"}'::jsonb
    )
    returning id into regent_practice;
  else
    update practices
      set organization_id = regent_org,
          integration_mode = 'legacy_mirror',
          source_system = 'boxly',
          whatsapp_status = 'connected',
          updated_at = now()
      where id = regent_practice;
  end if;

  insert into integrations (practice_id, source_system, display_name, mode, status, settings)
  values (
    regent_practice, 'boxly', 'Regent Boxly', 'legacy_mirror', 'connected',
    jsonb_build_object(
      'configNamespace', 'regent',
      'legacyLeadsTable', 'regent_dental_leads',
      'legacySupabaseUrlEnv', 'REGENT_LEGACY_SUPABASE_URL',
      'legacySupabaseServiceRoleKeyEnv', 'REGENT_LEGACY_SUPABASE_SERVICE_ROLE_KEY',
      'legacyApiBaseEnv', 'REGENT_BOXLY_API_BASE',
      'legacyEmailEnv', 'REGENT_BOXLY_EMAIL',
      'legacyPasswordEnv', 'REGENT_BOXLY_PASSWORD',
      'chatHistorySessionPrefix', 'uk_004_'
    )
  )
  on conflict (practice_id, source_system)
    do update set display_name = excluded.display_name,
                  mode = excluded.mode,
                  status = excluded.status,
                  settings = excluded.settings,
                  updated_at = now();

  select id into nuyu_org from organizations where slug = 'nuyu';
  if nuyu_org is null then
    insert into organizations (name, slug) values ('Nuyu Dental', 'nuyu')
    returning id into nuyu_org;
  end if;

  select id into nuyu_practice from practices where external_id = 'nuyu-boxly';
  if nuyu_practice is null then
    insert into practices (
      organization_id, name, status, integration_mode, native_runtime_enabled,
      source_system, external_id, whatsapp_status, external_payload
    )
    values (
      nuyu_org, 'Nuyu Dental', 'review', 'legacy_mirror', false,
      'boxly', 'nuyu-boxly', 'connected', '{"seededFrom":"slice_0_1_seed"}'::jsonb
    )
    returning id into nuyu_practice;
  else
    update practices
      set organization_id = nuyu_org,
          integration_mode = 'legacy_mirror',
          source_system = 'boxly',
          whatsapp_status = 'connected',
          updated_at = now()
      where id = nuyu_practice;
  end if;

  insert into integrations (practice_id, source_system, display_name, mode, status, settings)
  values (
    nuyu_practice, 'boxly', 'Nuyu Boxly', 'legacy_mirror', 'connected',
    jsonb_build_object(
      'configNamespace', 'nuyu',
      'legacyLeadsTable', 'nuyu_leads',
      'legacySupabaseUrlEnv', 'REGENT_LEGACY_SUPABASE_URL',
      'legacySupabaseServiceRoleKeyEnv', 'REGENT_LEGACY_SUPABASE_SERVICE_ROLE_KEY',
      'chatHistorySessionPrefix', 'uk_007_'
    )
  )
  on conflict (practice_id, source_system)
    do update set display_name = excluded.display_name,
                  mode = excluded.mode,
                  status = excluded.status,
                  settings = excluded.settings,
                  updated_at = now();

  insert into memberships (organization_id, practice_id, email, role)
  select regent_org, regent_practice, regent_client_email, 'client'
  where not exists (
    select 1 from memberships where practice_id = regent_practice and lower(email) = lower(regent_client_email)
  );

  insert into organization_memberships (organization_id, email, role)
  select regent_org, regent_client_email, 'client'
  where not exists (
    select 1 from organization_memberships where organization_id = regent_org and lower(email) = lower(regent_client_email)
  );

  insert into memberships (organization_id, practice_id, email, role)
  select nuyu_org, nuyu_practice, nuyu_client_email, 'client'
  where not exists (
    select 1 from memberships where practice_id = nuyu_practice and lower(email) = lower(nuyu_client_email)
  );

  insert into organization_memberships (organization_id, email, role)
  select nuyu_org, nuyu_client_email, 'client'
  where not exists (
    select 1 from organization_memberships where organization_id = nuyu_org and lower(email) = lower(nuyu_client_email)
  );

  foreach admin_email in array admin_emails loop
    insert into memberships (organization_id, practice_id, email, role)
    select regent_org, regent_practice, admin_email, 'admin'
    where not exists (
      select 1 from memberships where practice_id = regent_practice and lower(email) = lower(admin_email)
    );

    insert into memberships (organization_id, practice_id, email, role)
    select nuyu_org, nuyu_practice, admin_email, 'admin'
    where not exists (
      select 1 from memberships where practice_id = nuyu_practice and lower(email) = lower(admin_email)
    );
  end loop;
end $$;

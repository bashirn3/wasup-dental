-- Wasup Dental MVP schema draft.
-- Keep RLS policies tight before production use.

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text,
  clerk_org_id text unique,
  clerk_owner_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists organizations_slug_uidx
  on organizations (slug)
  where slug is not null;

create index if not exists organizations_clerk_owner_user_idx
  on organizations (clerk_owner_user_id);

create table if not exists practices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete set null,
  name text not null,
  website_url text,
  location text,
  phone text,
  status text not null default 'draft',
  integration_mode text not null default 'native',
  native_runtime_enabled boolean not null default false,
  source_system text not null default 'native',
  external_id text,
  external_payload jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  connected_number text,
  wasup_instance_id text,
  wasup_api_key text,
  whatsapp_status text not null default 'not_connected',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table practices add column if not exists organization_id uuid references organizations(id) on delete set null;
alter table practices add column if not exists clerk_org_id text;
alter table practices add column if not exists clerk_owner_user_id text;

create unique index if not exists practices_connected_number_uidx
  on practices (connected_number)
  where connected_number is not null;

create unique index if not exists practices_source_external_uidx
  on practices (source_system, external_id)
  where external_id is not null;

alter table practices add column if not exists integration_mode text not null default 'native';
alter table practices add column if not exists native_runtime_enabled boolean not null default false;
alter table practices add column if not exists source_system text not null default 'native';
alter table practices add column if not exists external_id text;
alter table practices add column if not exists external_payload jsonb not null default '{}'::jsonb;
alter table practices add column if not exists last_synced_at timestamptz;

create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  practice_id uuid not null references practices(id) on delete cascade,
  clerk_user_id text,
  email text,
  role text not null check (role in ('admin', 'client')),
  created_at timestamptz not null default now(),
  unique (practice_id, clerk_user_id)
);

alter table memberships add column if not exists organization_id uuid references organizations(id) on delete cascade;
alter table memberships add column if not exists email text;
alter table memberships alter column clerk_user_id drop not null;

create unique index if not exists memberships_practice_email_uidx
  on memberships (practice_id, lower(email))
  where email is not null;

create table if not exists organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  clerk_user_id text,
  email text,
  role text not null check (role in ('admin', 'client')),
  created_at timestamptz not null default now()
);

create unique index if not exists organization_memberships_user_uidx
  on organization_memberships (organization_id, clerk_user_id)
  where clerk_user_id is not null;

create unique index if not exists organization_memberships_email_uidx
  on organization_memberships (organization_id, lower(email))
  where email is not null;

create table if not exists integrations (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id) on delete cascade,
  source_system text not null,
  display_name text not null,
  mode text not null default 'legacy_mirror',
  status text not null default 'draft',
  settings jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (practice_id, source_system)
);

create table if not exists agent_versions (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id) on delete cascade,
  treatment text not null,
  version_number integer not null,
  title text not null,
  prompt text not null,
  rationale text,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (practice_id, treatment, version_number)
);

create table if not exists agent_control_configs (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id) on delete cascade,
  version_number integer not null,
  is_active boolean not null default false,
  first_message text not null,
  prompt text not null,
  tone text not null default 'warm',
  treatment_focus text[] not null default '{}',
  qualification_rules jsonb not null default '{}'::jsonb,
  safety_rules text[] not null default '{}',
  stage_filters jsonb not null default '{}'::jsonb,
  procedures jsonb not null default '[]'::jsonb,
  appointment_settings jsonb not null default '{}'::jsonb,
  payment_settings jsonb not null default '{}'::jsonb,
  workflow_settings jsonb not null default '{}'::jsonb,
  staff_review_rules jsonb not null default '{}'::jsonb,
  auto_contact_enabled boolean not null default false,
  launch_state text not null default 'draft',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (practice_id, version_number)
);

alter table agent_control_configs add column if not exists procedures jsonb not null default '[]'::jsonb;
alter table agent_control_configs add column if not exists appointment_settings jsonb not null default '{}'::jsonb;
alter table agent_control_configs add column if not exists payment_settings jsonb not null default '{}'::jsonb;
alter table agent_control_configs add column if not exists workflow_settings jsonb not null default '{}'::jsonb;

create unique index if not exists agent_control_configs_active_uidx
  on agent_control_configs (practice_id)
  where is_active;

create table if not exists knowledge_packets (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id) on delete cascade,
  treatment text not null,
  source_urls text[] not null default '{}',
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  confidence numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id) on delete cascade,
  name text,
  phone text,
  email text,
  treatment text,
  status text not null default 'new',
  source text not null default 'manual',
  source_system text not null default 'native',
  external_id text,
  external_payload jsonb not null default '{}'::jsonb,
  box_name text,
  box_stage text,
  needs_human boolean not null default false,
  ai_confidence numeric,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists leads_source_external_uidx
  on leads (practice_id, source_system, external_id)
  where external_id is not null;

create unique index if not exists leads_source_external_upsert_uidx
  on leads (practice_id, source_system, external_id);

alter table leads add column if not exists email text;
alter table leads add column if not exists source_system text not null default 'native';
alter table leads add column if not exists external_id text;
alter table leads add column if not exists external_payload jsonb not null default '{}'::jsonb;
alter table leads add column if not exists box_name text;
alter table leads add column if not exists box_stage text;
alter table leads add column if not exists last_synced_at timestamptz;
alter table leads alter column phone drop not null;

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id) on delete cascade,
  lead_id uuid references leads(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  body text not null,
  ai_generated boolean not null default false,
  source_system text not null default 'native',
  external_id text,
  external_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists messages_source_external_uidx
  on messages (practice_id, source_system, external_id)
  where external_id is not null;

alter table messages add column if not exists source_system text not null default 'native';
alter table messages add column if not exists external_id text;
alter table messages add column if not exists external_payload jsonb not null default '{}'::jsonb;

create table if not exists activity_events (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id) on delete cascade,
  event_type text not null,
  title text not null,
  description text,
  payload jsonb not null default '{}'::jsonb,
  source_system text not null default 'native',
  external_id text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists activity_events_source_external_uidx
  on activity_events (practice_id, source_system, external_id)
  where external_id is not null;

alter table activity_events add column if not exists source_system text not null default 'native';
alter table activity_events add column if not exists external_id text;
alter table activity_events add column if not exists last_synced_at timestamptz;

create table if not exists workflow_provisionings (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id) on delete cascade,
  workflow_type text not null,
  template_key text not null,
  display_name text not null,
  mode text not null default 'test',
  status text not null default 'draft',
  active boolean not null default false,
  launch_ready boolean not null default false,
  provider_instance_id text,
  provider_number text,
  webhook_path text,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (practice_id, workflow_type)
);

alter table workflow_provisionings add column if not exists workflow_type text;
alter table workflow_provisionings add column if not exists template_key text;
alter table workflow_provisionings add column if not exists display_name text;
alter table workflow_provisionings add column if not exists mode text not null default 'test';
alter table workflow_provisionings add column if not exists status text not null default 'draft';
alter table workflow_provisionings add column if not exists active boolean not null default false;
alter table workflow_provisionings add column if not exists launch_ready boolean not null default false;
alter table workflow_provisionings add column if not exists provider_instance_id text;
alter table workflow_provisionings add column if not exists provider_number text;
alter table workflow_provisionings add column if not exists webhook_path text;
alter table workflow_provisionings add column if not exists config jsonb not null default '{}'::jsonb;

create table if not exists external_mappings (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id) on delete cascade,
  source_system text not null,
  local_table text not null,
  local_id uuid not null,
  external_id text not null,
  external_payload jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (practice_id, source_system, local_table, external_id)
);

create table if not exists sync_runs (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid references practices(id) on delete cascade,
  source_system text not null,
  sync_type text not null,
  status text not null default 'started',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  skipped_count integer not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists sync_runs_practice_started_idx
  on sync_runs (practice_id, started_at desc);

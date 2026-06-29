-- Runtime config snapshots (read by the n8n worker) + config audit trail.
-- Additive only. No secrets are ever stored here.

create table if not exists runtime_config_versions (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id) on delete cascade,
  version_number integer not null,
  is_published boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  source_config_id uuid,
  published_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  unique (practice_id, version_number)
);

-- At most one published runtime config per practice.
create unique index if not exists runtime_config_versions_published_uidx
  on runtime_config_versions (practice_id)
  where is_published;

create index if not exists runtime_config_versions_practice_idx
  on runtime_config_versions (practice_id, version_number desc);

create table if not exists config_audit_events (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id) on delete cascade,
  actor text,
  action text not null,
  entity text not null,
  entity_id uuid,
  summary text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index if not exists config_audit_events_practice_idx
  on config_audit_events (practice_id, created_at desc);

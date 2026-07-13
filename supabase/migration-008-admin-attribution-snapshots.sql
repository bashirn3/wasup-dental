create table if not exists public.admin_attribution_snapshots (
  snapshot_key text primary key,
  generated_at timestamptz not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_admin_attribution_snapshots_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_admin_attribution_snapshots_updated_at on public.admin_attribution_snapshots;

create trigger set_admin_attribution_snapshots_updated_at
before update on public.admin_attribution_snapshots
for each row
execute function public.set_admin_attribution_snapshots_updated_at();

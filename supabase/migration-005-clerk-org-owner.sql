-- Clerk organization tenancy:
-- clerk_org_id stores org_xxx going forward.
-- clerk_owner_user_id preserves the original owner user_xxx for legacy fallback
-- and owner-only destructive actions.

alter table tenants
  add column if not exists clerk_owner_user_id text;

create index if not exists tenants_clerk_owner_user_idx
  on tenants (clerk_owner_user_id);

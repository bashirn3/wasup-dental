-- Engine wiring: run after schema.sql

-- Connected WhatsApp number per tenant (matched against inbound webhooks).
alter table tenants add column if not exists wasup_phone text;

create index if not exists tenants_wasup_instance_idx on tenants (wasup_instance_id);
create index if not exists tenants_wasup_phone_idx on tenants (wasup_phone);
create index if not exists messages_session_idx on messages (tenant_id, created_at desc);

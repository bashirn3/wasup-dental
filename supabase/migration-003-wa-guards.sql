-- WhatsApp link guards: one instance + one linked phone per tenant row.

-- Never persist wasup_phone without a linked instance.
create or replace function tenants_wa_consistency() returns trigger as $$
begin
  if new.wasup_phone is not null and new.wasup_instance_id is null then
    new.wasup_phone := null;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists tenants_wa_consistency on tenants;
create trigger tenants_wa_consistency
  before insert or update on tenants
  for each row execute function tenants_wa_consistency();

-- One Wasup instance id per garage account.
create unique index if not exists tenants_wasup_instance_unique
  on tenants (wasup_instance_id)
  where wasup_instance_id is not null;

-- One linked WhatsApp number across all tenants.
create unique index if not exists tenants_wasup_phone_linked_unique
  on tenants (wasup_phone)
  where wasup_phone is not null and wasup_instance_id is not null;

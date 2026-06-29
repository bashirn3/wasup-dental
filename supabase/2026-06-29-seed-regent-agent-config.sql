-- Seed the ACTIVE agent_control_configs row for Regent Dental.
--
-- Why: so the dashboard Agent tab shows Regent's real persona/hours/per-treatment
-- first messages (not blanks), and so the n8n runtime-config overlay's first read
-- is a NO-OP (these values match what is currently hardcoded in the workflows).
--
-- Safe to run multiple times: it only inserts if Regent has no active config yet.
-- Depends on 2026-06-29-slice-0-1-regent-nuyu.sql having created the practice.

do $$
declare
  regent_practice uuid;
  next_version integer;
begin
  select id into regent_practice from practices where external_id = 'regent-boxly';
  if regent_practice is null then
    raise notice 'Regent practice (external_id=regent-boxly) not found; run the slice-0-1 seed first. Skipping.';
    return;
  end if;

  -- Already has an active config? Leave it alone (idempotent).
  if exists (select 1 from agent_control_configs where practice_id = regent_practice and is_active) then
    raise notice 'Regent already has an active agent config; skipping seed.';
    return;
  end if;

  select coalesce(max(version_number), 0) + 1 into next_version
  from agent_control_configs where practice_id = regent_practice;

  insert into agent_control_configs (
    practice_id, version_number, is_active, first_message, prompt, tone,
    treatment_focus, safety_rules, launch_state, auto_contact_enabled,
    workflow_settings, created_by
  )
  values (
    regent_practice,
    next_version,
    true,
    E'Hi 👋 Thanks for contacting Regent Dental.\n\nTo start, what would you like to change about your teeth?',
    'Regent Dental WhatsApp assistant. Procedure-aware booking agent. The detailed system prompt and booking tools live in the n8n workflow; client-editable persona, hours and per-treatment first messages are managed here.',
    'warm',
    array['invisalign','implants','full_arch_implants','composites','veneers','whitening','hygiene'],
    array[
      'Do not diagnose, prescribe, or confirm clinical suitability over WhatsApp.',
      'Do not guarantee outcomes, timelines, prices, discounts, availability, or finance approval.',
      'Use only the selected treatment facts. If a fact is missing, say the clinic can confirm it at consultation.',
      'Escalate severe pain, swelling, bleeding, trauma, infection, or urgent symptoms to the clinic.'
    ],
    'live',
    false,
    jsonb_build_object(
      'clientEditable', jsonb_build_object(
        'assistantName', 'Emily',
        'openingHours', 'Open 5 days a week, with late evening appointments on Tuesdays and Thursdays, and open one Saturday a month.',
        'closingHours', '',
        'knowledge', '',
        'treatmentFirstMessages', jsonb_build_object(
          'invisalign', E'Hi 👋 Thanks for contacting Regent Dental.\n\nTo start, what would you like to change about your teeth?',
          'implants', E'Hi, thanks for contacting Regent Dental 😊 We’d be happy to help with dental implant options.\n\nTo point you in the right direction, which tooth or teeth are you looking to replace?',
          'full_arch_implants', E'Hi, welcome to Regent Dental 😊 We help patients exploring full arch implants / All-on-4 options here in Ilkley.\n\nAre you looking to replace most or all of your teeth in one arch?',
          'composites', E'Hi, thanks for contacting Regent Dental 😊 We can help with composite bonding for things like chips, gaps, uneven edges, shape or colour concerns.\n\nWhich teeth are you hoping to improve?',
          'veneers', E'Hi, thanks for contacting Regent Dental 😊 We’d be happy to help with veneers or a smile makeover.\n\nWhat would you like to change about your smile?',
          'whitening', E'Hi, welcome to Regent Dental 😊 We’d be happy to help with professional teeth whitening and talk you through safe options.\n\nHave you whitened your teeth before?',
          'hygiene', E'Hi, thanks for contacting Regent Dental. We can help with hygiene appointments and routine cleaning.\n\nAre you looking for a hygienist visit or a general check-up?'
        )
      )
    ),
    'seed_regent_agent_config'
  );

  raise notice 'Seeded active agent config v% for Regent.', next_version;
end $$;

-- Record Dental Aesthetica's consultation setup where the dashboard can show it.
--
-- These values are not new. They are what the booking workflow already does:
-- implant consultations with Dr Ahmed Tahboub (45 minutes, preferred) or Dr
-- Adnan Safdar (30 minutes), against a £30 refundable deposit. Until now they
-- existed only inside the workflow's tool code, so the practice had no way to
-- see them and no way to change them.
--
-- Copying them here first means the panel tells the truth from the moment it
-- appears, and that when the workflow is changed to read this config its first
-- read is a no-op rather than a change of behaviour.
--
-- Practitioner ids are Dentally's, held as text: they identify a clinician
-- rather than count anything, and text cannot lose precision in JSON.
--
-- Safe to run multiple times: it leaves an existing treatment list alone.

do $$
declare
  da_practice uuid;
  active_config uuid;
  settings jsonb;
  editable jsonb;
  treatments jsonb;
begin
  select id into da_practice from practices where name = 'Dental Aesthetica';
  if da_practice is null then
    raise notice 'Dental Aesthetica practice not found; skipping.';
    return;
  end if;

  select id, coalesce(workflow_settings, '{}'::jsonb)
    into active_config, settings
    from agent_control_configs
   where practice_id = da_practice and is_active
   order by version_number desc
   limit 1;

  if active_config is null then
    raise notice 'Dental Aesthetica has no active agent config; skipping.';
    return;
  end if;

  editable := coalesce(settings -> 'clientEditable', '{}'::jsonb);

  if jsonb_array_length(coalesce(editable -> 'treatments', '[]'::jsonb)) > 0 then
    raise notice 'Dental Aesthetica already has treatment controls; leaving them alone.';
    return;
  end if;

  treatments := jsonb_build_array(
    jsonb_build_object(
      'id', 'implants',
      'name', 'Dental Implants',
      'treatmentPageUrl', '',
      'practitionerIds', jsonb_build_array('386136', '15185'),
      -- The preferred clinician's length. The per-clinician figures below are
      -- what the workflow actually books, and one number per treatment could
      -- not describe both without being wrong about one of them.
      'appointmentLengthMinutes', 45,
      'practitionerLengthMinutes', jsonb_build_object('386136', 45, '15185', 30),
      'depositRequired', true,
      'depositAmount', 30
    )
  );

  update agent_control_configs
     set workflow_settings = settings || jsonb_build_object(
           'clientEditable', editable || jsonb_build_object('treatments', treatments)
         ),
         updated_at = now()
   where id = active_config;

  raise notice 'Recorded Dental Aesthetica treatment controls on config %.', active_config;
end $$;

-- Onboard Leigh Dental Centre so the practice can see and edit Jo.
--
-- Jo has been answering Leigh's Invisalign leads from n8n since 7 November,
-- booking into Dentally with Dr Simal Shah and taking a £20 refundable deposit
-- through Stripe. Every fact below is copied from that workflow as it runs today,
-- so the Agent tab tells the truth from the moment it appears, and the first time
-- the workflow reads this config instead of its own copy nothing changes.
--
-- No logins are seeded. The people testing Leigh are internal admins and already
-- see every practice; Leigh's own staff are added once they are ready.
--
-- The Dentally and Stripe credentials stay in n8n. These rows only let the
-- Connections page say what is running.
--
-- WhatsApp is left unconnected here, as for Dental Aesthetica: Leigh's line is
-- run by n8n, and a number on the practice would let the Connect page provision
-- draft workflows against it.
--
-- Safe to run multiple times. An existing agent config is left alone so edits
-- made in the dashboard are never overwritten.

do $$
declare
  leigh_org uuid;
  leigh_practice uuid;
  editable jsonb;
begin
  select id into leigh_org from organizations where slug = 'leigh-dental-centre';
  if leigh_org is null then
    insert into organizations (name, slug) values ('Leigh Dental Centre', 'leigh-dental-centre')
    returning id into leigh_org;
  end if;

  select id into leigh_practice from practices where external_id = 'leigh-dental-centre';
  if leigh_practice is null then
    insert into practices (
      organization_id, name, website_url, location, phone, status,
      integration_mode, native_runtime_enabled, source_system, external_id,
      whatsapp_status, external_payload
    )
    values (
      leigh_org, 'Leigh Dental Centre', 'https://www.leighdentalcentre.co.uk',
      'Leigh-on-Sea, Essex', '01702 472 929', 'review',
      'native', false, 'native', 'leigh-dental-centre',
      'not_connected',
      jsonb_build_object(
        'client', 'Leigh Dental Centre',
        'agentName', 'Jo',
        'initialTreatment', 'invisalign',
        'n8nInboundWorkflowId', '7bVU9sGG19cfqyYx'
      )
    )
    returning id into leigh_practice;
  end if;

  insert into integrations (practice_id, source_system, display_name, mode, status)
  values
    (leigh_practice, 'dentally', 'Dentally booking', 'native', 'connected'),
    (leigh_practice, 'stripe', 'Stripe deposits', 'native', 'connected')
  on conflict (practice_id, source_system) do update
     set display_name = excluded.display_name,
         mode = excluded.mode,
         updated_at = now();

  if exists (select 1 from agent_control_configs where practice_id = leigh_practice) then
    raise notice 'Leigh Dental Centre already has an agent config; leaving it alone.';
    return;
  end if;

  editable := $json$
{
  "assistantName": "Jo",
  "openingHours": "Mon, Tue, Thu 08:15-18:00; Wed, Fri 08:15-17:00; Sat 09:00-14:00 by appointment only; Sun closed",
  "closingHours": "",
  "knowledge": "Credentials: ranked in the Top 1% of Invisalign providers in Europe, part of the Apex Global Top 150, with over 1,000 Invisalign cases completed. Private and NHS patients, 40+ years in Southend/Leigh-on-Sea.\nMost patients are Comprehensive.",
  "otherMenuItems": "",
  "misc": {
    "address": "790 London Road, Leigh-On-Sea, Essex, SS9 3NJ",
    "phone": "01702 472 929",
    "parking": "",
    "notes": "Email: info@leighdentalcentre.co.uk. The phone number is also for dental emergencies."
  },
  "treatmentFirstMessages": {
    "invisalign": "Hi, it's Jo from Leigh Dental Centre. I saw you were interested in Invisalign. I can help with prices, suitability, and the next step. Would you like to book a free consultation?"
  },
  "treatmentTemplates": {},
  "treatmentFacts": {
    "invisalign": {
      "generalInfo": "Invisalign uses a series of clear removable aligners that gradually move teeth.",
      "benefits": [],
      "suitability": [],
      "process": [
        "Consultation with a free iTero scan and a suitability check by the clinician (the dentist)",
        "A ClinCheck plan is developed and gone through with the patient",
        "An OPG X-ray to check bone and teeth health",
        "Aligners fitted, with attachments placed at the fit appointment",
        "Reviews every 8-10 weeks, with any IPR done at reviews",
        "Refinements as needed",
        "Retainers (removable only, or fixed plus removable)",
        "All of the above is included in the price"
      ],
      "pricing": "Invisalign Comprehensive: £3,995. Includes whitening, Viveras, unlimited aligners and as many refinements as needed.\nInvisalign Light: £3,100.",
      "financeOffering": "0% APR over 12 months, or longer terms up to 60 months. When quoting monthly prices, always lead with the cheapest option, Invisalign Light: from around £71/month over 60 months. Only quote Comprehensive monthly (from £91.73/month over 60 months) if the patient asks about Comprehensive specifically.",
      "pricingOffers": [
        "Black Friday Invisalign package, only available as part of the Black Friday Open Days. Includes FREE teeth whitening (worth £399), FREE Vivera retainers (worth £700), FREE fixed bonded retainers (worth £300+) and a FREE hygiene visit + water flosser (worth £100+). That is over £1,500 worth of free extras.",
        "Black Friday offer ends 5 December; valid for bookings until 31 January provided they have been in before 5 December."
      ],
      "contraindications": [],
      "faqs": [],
      "confidence": 1
    }
  },
  "treatments": [
    {
      "id": "invisalign",
      "name": "Invisalign",
      "treatmentPageUrl": "",
      "practitionerIds": ["13779"],
      "appointmentLengthMinutes": 30,
      "depositRequired": true,
      "depositAmount": 20
    }
  ]
}
$json$::jsonb;

  insert into agent_control_configs (
    practice_id, version_number, is_active, first_message, prompt, tone,
    treatment_focus, safety_rules, appointment_settings, workflow_settings,
    auto_contact_enabled, launch_state, created_by
  )
  values (
    leigh_practice, 1, true,
    editable -> 'treatmentFirstMessages' ->> 'invisalign',
    'Jo, Leigh Dental Centre''s WhatsApp Invisalign assistant. The booking rules and tools live in the n8n workflow; name, hours, contact details, treatment facts, prices, offers and knowledge are managed here.',
    'warm',
    array['invisalign'],
    array[
      'Do not diagnose or confirm clinical suitability, and do not promise a specific result or treatment length.',
      'Do not guarantee that Invisalign is suitable: the dentist confirms this at the consultation after the free iTero scan.',
      'Do not invent prices, dentists, finance terms, dates, times, address, hours, phone, or appointment availability.',
      'Escalate pain, swelling, infection, trauma, complaints, or medical uncertainty to the clinic team.'
    ],
    jsonb_build_object(
      'mode', 'live_n8n',
      'availabilitySource', 'dentally',
      'defaultDurationMinutes', 30,
      'dentists', jsonb_build_array(
        jsonb_build_object('id', '13779', 'name', 'Dr Simal Shah', 'consultDurationMinutes', 30)
      ),
      'bookingDeposit', jsonb_build_object('amount', 20, 'currency', 'GBP', 'refundable', true)
    ),
    jsonb_build_object(
      'mode', 'live_n8n',
      'launchState', 'preview',
      'clientEditable', editable
    ),
    false, 'preview', 'bashir@tryrapidscreen.com'
  );

  raise notice 'Leigh Dental Centre onboarded (practice %).', leigh_practice;
end $$;

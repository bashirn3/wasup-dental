// Seeds ACTIVE agent_control_configs for Regent + NuYu so the dashboard Agent
// tab loads real values and /api/runtime-config serves them. Idempotent: skips a
// practice that already has an active config. Run:
//   node --env-file=.env.local scripts/seed-agent-configs.mjs
import { createClient } from "@supabase/supabase-js";

const ours = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const SAFETY = [
  "Do not diagnose, prescribe, or confirm clinical suitability over WhatsApp.",
  "Do not guarantee outcomes, timelines, prices, discounts, availability, or finance approval.",
  "Use only the selected treatment facts. If a fact is missing, say the clinic can confirm it at consultation.",
  "Escalate severe pain, swelling, bleeding, trauma, infection, or urgent symptoms to the clinic.",
];

const REGENT_TFM = {
  invisalign: "Hi 👋 Thanks for contacting Regent Dental.\n\nTo start, what would you like to change about your teeth?",
  implants: "Hi, thanks for contacting Regent Dental 😊 We’d be happy to help with dental implant options.\n\nTo point you in the right direction, which tooth or teeth are you looking to replace?",
  full_arch_implants: "Hi, welcome to Regent Dental 😊 We help patients exploring full arch implants / All-on-4 options here in Ilkley.\n\nAre you looking to replace most or all of your teeth in one arch?",
  composites: "Hi, thanks for contacting Regent Dental 😊 We can help with composite bonding for things like chips, gaps, uneven edges, shape or colour concerns.\n\nWhich teeth are you hoping to improve?",
  veneers: "Hi, thanks for contacting Regent Dental 😊 We’d be happy to help with veneers or a smile makeover.\n\nWhat would you like to change about your smile?",
  whitening: "Hi, welcome to Regent Dental 😊 We’d be happy to help with professional teeth whitening and talk you through safe options.\n\nHave you whitened your teeth before?",
  hygiene: "Hi, thanks for contacting Regent Dental. We can help with hygiene appointments and routine cleaning.\n\nAre you looking for a hygienist visit or a general check-up?",
};

const configs = [
  {
    externalId: "regent-boxly",
    firstMessage: REGENT_TFM.invisalign,
    prompt:
      "Regent Dental WhatsApp assistant. Procedure-aware booking agent. The detailed system prompt and booking tools live in the n8n workflow; client-editable persona, hours and per-treatment first messages are managed here.",
    treatmentFocus: ["invisalign", "implants", "full_arch_implants", "composites", "veneers", "whitening", "hygiene"],
    clientEditable: {
      assistantName: "Emily",
      openingHours:
        "Open 5 days a week, with late evening appointments on Tuesdays and Thursdays, and open one Saturday a month.",
      closingHours: "",
      knowledge: "",
      treatmentFirstMessages: REGENT_TFM,
    },
  },
  {
    externalId: "nuyu-boxly",
    firstMessage: "Hi 👋 Thanks for contacting Nuyu Dental. How can we help with your smile today?",
    prompt:
      "Nuyu Dental WhatsApp assistant. Client-editable persona, hours and per-treatment first messages are managed here.",
    treatmentFocus: ["invisalign"],
    clientEditable: {
      assistantName: "",
      openingHours: "",
      closingHours: "",
      knowledge: "",
      treatmentFirstMessages: {},
    },
  },
];

for (const cfg of configs) {
  const { data: practice } = await ours
    .from("practices")
    .select("id, name")
    .eq("external_id", cfg.externalId)
    .maybeSingle();
  if (!practice) {
    console.log(`SKIP ${cfg.externalId}: practice not found`);
    continue;
  }

  const { data: active } = await ours
    .from("agent_control_configs")
    .select("id")
    .eq("practice_id", practice.id)
    .eq("is_active", true)
    .maybeSingle();
  if (active) {
    console.log(`SKIP ${cfg.externalId}: already has active config`);
    continue;
  }

  const { error } = await ours.from("agent_control_configs").insert({
    practice_id: practice.id,
    version_number: 1,
    is_active: true,
    first_message: cfg.firstMessage,
    prompt: cfg.prompt,
    tone: "warm",
    treatment_focus: cfg.treatmentFocus,
    safety_rules: SAFETY,
    qualification_rules: {},
    stage_filters: {},
    workflow_settings: { clientEditable: cfg.clientEditable },
    appointment_settings: {},
    launch_state: "live",
    auto_contact_enabled: false,
    created_by: "seed_agent_configs_script",
  });
  console.log(error ? `ERR ${cfg.externalId}: ${error.message}` : `OK ${cfg.externalId}: active config v1 for ${practice.name}`);
}

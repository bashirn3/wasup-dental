// Backfills the structured Agent-tab fact cards for Regent from the real
// procedure-config (the same data agent.wasup.co/dental holds). It merges into
// workflow_settings.clientEditable on the ACTIVE agent_control_configs row,
// preserving the prompt, knowledge box, and any admin-managed fields.
//
//   node --env-file=.env.local scripts/backfill-fact-cards.mjs
//
// Read/write scope: our own Supabase only. No WhatsApp sends, no n8n triggers,
// no provider changes. Idempotent — safe to re-run.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const REGENT_CFG =
  "/Users/bashirsani/Desktop/Projects/boxly-intergations/n8n-workflows/regent-procedure-config.json";

function factsFromTreatment(t) {
  const f = t.facts ?? {};
  const escalation = t.positioning?.escalation_notes ?? [];
  return {
    generalInfo: f.general_info ?? "",
    benefits: Array.isArray(f.benefits) ? f.benefits : [],
    suitability: Array.isArray(f.suitability) ? f.suitability : [],
    process: Array.isArray(f.process) ? f.process : [],
    pricing: f.pricing ?? "",
    financeOffering: f.finance_offering ?? "",
    pricingOffers: Array.isArray(f.pricing_offers) ? f.pricing_offers : [],
    contraindications: Array.isArray(escalation) ? escalation : [],
    faqs: [],
    confidence: 0,
  };
}

function buildRegentPatch() {
  const cfg = JSON.parse(readFileSync(REGENT_CFG, "utf8"));
  const clinic = cfg.clinic ?? {};
  const treatments = cfg.treatments ?? {};

  const treatmentFacts = {};
  const treatmentFirstMessages = {};
  for (const [id, t] of Object.entries(treatments)) {
    if (t.enabled === false) continue;
    treatmentFacts[id] = factsFromTreatment(t);
    if (typeof t.first_message === "string" && t.first_message.trim()) {
      treatmentFirstMessages[id] = t.first_message;
    }
  }

  const noteBits = [];
  if (clinic.opening_notes) noteBits.push(clinic.opening_notes);
  if (clinic.email) noteBits.push(`Email: ${clinic.email}`);
  if (Array.isArray(clinic.areas_served) && clinic.areas_served.length)
    noteBits.push(`Areas served: ${clinic.areas_served.join(", ")}`);

  return {
    assistantName: clinic.assistant_name ?? "",
    misc: {
      address: clinic.address ?? "",
      phone: clinic.phone ?? "",
      parking: clinic.parking ?? "",
      notes: noteBits.join("\n"),
    },
    treatmentFacts,
    treatmentFirstMessages,
  };
}

async function backfill(supabase, externalId, patch) {
  const { data: practice } = await supabase
    .from("practices")
    .select("id, name")
    .eq("external_id", externalId)
    .maybeSingle();
  if (!practice) {
    console.log(`SKIP ${externalId}: practice not found`);
    return;
  }

  const { data: active } = await supabase
    .from("agent_control_configs")
    .select("id, version_number, workflow_settings")
    .eq("practice_id", practice.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!active) {
    console.log(`SKIP ${externalId}: no active config row (run seed-agent-configs.mjs first)`);
    return;
  }

  const ws = active.workflow_settings ?? {};
  const existing = ws.clientEditable ?? {};

  // Merge: keep existing assistantName/knowledge/hours unless empty, but always
  // refresh the structured facts/openers/misc from the source of truth.
  const clientEditable = {
    ...existing,
    assistantName: existing.assistantName?.trim() ? existing.assistantName : patch.assistantName,
    misc: { ...(existing.misc ?? {}), ...patch.misc },
    treatmentFacts: { ...(existing.treatmentFacts ?? {}), ...patch.treatmentFacts },
    treatmentFirstMessages: {
      ...(existing.treatmentFirstMessages ?? {}),
      ...patch.treatmentFirstMessages,
    },
  };

  const { error } = await supabase
    .from("agent_control_configs")
    .update({
      workflow_settings: { ...ws, clientEditable },
      updated_at: new Date().toISOString(),
    })
    .eq("id", active.id);

  if (error) {
    console.log(`ERR ${externalId}: ${error.message}`);
    return;
  }
  const treatments = Object.keys(patch.treatmentFacts);
  console.log(
    `OK ${practice.name} (v${active.version_number}) — ${treatments.length} fact cards: ${treatments.join(", ")}`,
  );
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

await backfill(supabase, "regent-boxly", buildRegentPatch());

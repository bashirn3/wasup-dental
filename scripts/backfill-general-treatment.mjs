// Backfills the new Agent-tab "General" treatment for Regent and NuYu from the
// old agent.wasup.co dental builder. The old builder stores catch-all dental
// content in manualInfo.otherMenuItems, not as a treatment chip. This script
// turns that into a structured "general" fact card while preserving current
// dashboard edits.
//
//   node --env-file=.env.local scripts/backfill-general-treatment.mjs
//
// Scope: wasup-dental Supabase agent_control_configs only. No WhatsApp sends,
// no n8n triggers, no provider changes.
import { createClient } from "@supabase/supabase-js";

const OLD_BUILDER_PROJECTS = {
  "regent-boxly": "5e05b892-855b-42c0-8342-e4d8daca71f7",
  "nuyu-boxly": "4af83fa7-68c3-4d04-8e11-2c7f234a03a1",
};

function cleanBuilderPrefix(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/^__other_menu_cards_v1__\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseOtherMenuCards(value) {
  const clean = cleanBuilderPrefix(value);
  if (!clean) return [];
  try {
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed.cards)) {
      return parsed.cards.filter((item) => typeof item === "string" && item.trim());
    }
  } catch {
    // Some older records may be free text. Fall through to line splitting.
  }
  return clean
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildGeneralFacts(manualInfo, clinicName) {
  const misc = manualInfo?.misc ?? {};
  const cards = parseOtherMenuCards(manualInfo?.otherMenuItems);
  const generalInfo =
    cards[0] ??
    [
      `${clinicName} can help with general dental enquiries and route patients to the right team.`,
      misc.address ? `Address: ${misc.address}.` : "",
      misc.phone ? `Phone: ${misc.phone}.` : "",
      misc.parking ? `Parking: ${misc.parking}.` : "",
      misc.notes ? `Notes: ${misc.notes}.` : "",
    ]
      .filter(Boolean)
      .join(" ");

  return {
    generalInfo,
    benefits: [
      "Helps patients with non-specific dental enquiries.",
      "Routes patients to the right treatment, clinician, or reception team.",
      "Keeps answers grounded in practice information and avoids unsupported claims.",
    ],
    suitability: [
      "Patients asking general questions about the practice, appointments, dental concerns, or available services.",
      "Patients who are not sure which treatment they need yet.",
    ],
    process: [
      "Ask one clear follow-up question to understand what the patient needs.",
      "If the enquiry maps to a specific treatment, move them toward that treatment pathway.",
      "For clinical suitability, pain, swelling, trauma, or urgent concerns, route to the clinic team.",
    ],
    pricing: "Use the specific treatment pricing where available. If no price is listed, say the team can confirm at consultation or by phone.",
    financeOffering: "Mention finance only where it is explicitly available in the relevant treatment facts.",
    pricingOffers: [],
    contraindications: [
      "Do not diagnose or confirm clinical suitability over WhatsApp.",
      "Do not invent prices, guarantees, treatment timelines, or availability.",
      "Do not promise that a treatment is suitable before a clinician has reviewed the patient.",
    ],
    faqs: cards.slice(1, 8).map((card) => ({
      question: "Can you help with this?",
      answer: card,
    })),
    confidence: 1,
  };
}

function mergeMisc(current, oldMisc) {
  const existing = current && typeof current === "object" ? current : {};
  const old = oldMisc && typeof oldMisc === "object" ? oldMisc : {};
  return {
    address: existing.address?.trim() ? existing.address : old.address ?? "",
    phone: existing.phone?.trim() ? existing.phone : old.phone ?? "",
    parking: existing.parking?.trim() ? existing.parking : old.parking ?? "",
    notes: existing.notes?.trim() ? existing.notes : old.notes ?? "",
  };
}

async function fetchOldProject(projectId) {
  const res = await fetch(`https://agent.wasup.co/api/projects/${projectId}`);
  if (!res.ok) throw new Error(`Old builder fetch failed for ${projectId}: ${res.status}`);
  return res.json();
}

async function backfillGeneral(supabase, externalId, oldProjectId) {
  const oldProject = await fetchOldProject(oldProjectId);
  const manualInfo = oldProject.manualInfo ?? {};
  const clinicName = oldProject.project?.clinicName ?? externalId;
  const otherMenuItems = manualInfo.otherMenuItems ?? "";

  const { data: practice, error: practiceError } = await supabase
    .from("practices")
    .select("id, name")
    .eq("external_id", externalId)
    .maybeSingle();
  if (practiceError || !practice) throw new Error(practiceError?.message ?? `${externalId} not found`);

  const { data: active, error: activeError } = await supabase
    .from("agent_control_configs")
    .select("id, version_number, workflow_settings")
    .eq("practice_id", practice.id)
    .eq("is_active", true)
    .maybeSingle();
  if (activeError || !active) throw new Error(activeError?.message ?? `${externalId} active config not found`);

  const ws = active.workflow_settings ?? {};
  const existing = ws.clientEditable ?? {};
  const generalFacts = buildGeneralFacts(manualInfo, clinicName);
  const clientEditable = {
    ...existing,
    otherMenuItems: existing.otherMenuItems?.trim() ? existing.otherMenuItems : otherMenuItems,
    misc: mergeMisc(existing.misc, manualInfo.misc),
    treatmentFacts: {
      ...(existing.treatmentFacts ?? {}),
      general: generalFacts,
    },
    treatmentFirstMessages: {
      ...(existing.treatmentFirstMessages ?? {}),
      general:
        (existing.treatmentFirstMessages ?? {}).general ??
        `Hi 👋 Thanks for contacting ${practice.name}. How can we help today?`,
    },
  };

  const { error: updateError } = await supabase
    .from("agent_control_configs")
    .update({
      workflow_settings: { ...ws, clientEditable },
      updated_at: new Date().toISOString(),
    })
    .eq("id", active.id);
  if (updateError) throw new Error(updateError.message);

  console.log(
    `OK ${practice.name} v${active.version_number}: General card from ${oldProjectId} (${generalFacts.faqs.length} menu FAQs)`,
  );
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

for (const [externalId, projectId] of Object.entries(OLD_BUILDER_PROJECTS)) {
  await backfillGeneral(supabase, externalId, projectId);
}

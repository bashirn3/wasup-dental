// Compiles Regent's per-treatment facts/pricing from the n8n procedure-config
// into a single readable knowledge document and writes it into the active
// agent_control_configs row (workflow_settings.clientEditable.knowledge), so the
// dashboard Agent tab Knowledge box is pre-filled with the real clinic facts.
//   node --env-file=.env.local scripts/import-regent-knowledge.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const CFG_PATH =
  "/Users/bashirsani/Desktop/Projects/boxly-intergations/n8n-workflows/regent-procedure-config.json";

const cfg = JSON.parse(readFileSync(CFG_PATH, "utf8"));
const clinic = cfg.clinic ?? {};
const defaults = cfg.defaults ?? {};

const lines = [];
lines.push(`# ${clinic.name ?? "Regent Dental"} — treatment knowledge`);
lines.push("");
lines.push("## Practice");
if (clinic.address) lines.push(`- Address: ${clinic.address}`);
if (clinic.phone) lines.push(`- Phone: ${clinic.phone}`);
if (clinic.email) lines.push(`- Email: ${clinic.email}`);
if (clinic.opening_notes || defaults.practice_hours)
  lines.push(`- Hours: ${clinic.opening_notes ?? defaults.practice_hours}`);
if (clinic.parking) lines.push(`- Parking: ${clinic.parking}`);
if (Array.isArray(clinic.areas_served) && clinic.areas_served.length)
  lines.push(`- Areas served: ${clinic.areas_served.join(", ")}`);
if (defaults.consultation_fee_note) lines.push(`- Note: ${defaults.consultation_fee_note}`);

const treatments = cfg.treatments ?? {};
for (const t of Object.values(treatments)) {
  if (t.enabled === false) continue;
  const facts = t.facts ?? {};
  const booking = t.booking ?? {};
  const rules = t.messaging_rules ?? {};

  lines.push("");
  lines.push(`## ${t.display_name ?? t.id}`);
  if (facts.general_info) lines.push(`- About: ${facts.general_info}`);
  if (facts.pricing) lines.push(`- Pricing: ${facts.pricing}`);
  if (facts.finance_offering) lines.push(`- Finance: ${facts.finance_offering}`);
  if (Array.isArray(facts.pricing_offers) && facts.pricing_offers.length)
    lines.push(`- Current offers: ${facts.pricing_offers.join(" ")}`);

  const consult = [];
  if (booking.appointment_name) consult.push(booking.appointment_name);
  if (typeof booking.consultation_fee === "number") consult.push(`consultation £${booking.consultation_fee}`);
  if (booking.consultation_offer) consult.push(booking.consultation_offer);
  if (booking.deposit_required && booking.deposit_amount)
    consult.push(
      `£${booking.deposit_amount} ${booking.deposit_refundable ? "refundable " : ""}deposit to secure the booking`,
    );
  if (booking.cbct_scan_required && booking.cbct_scan_price)
    consult.push(`CBCT scan £${booking.cbct_scan_price} (deducted from treatment if you proceed)`);
  if (consult.length) lines.push(`- Consultation: ${consult.join("; ")}.`);

  if (Array.isArray(facts.suitability) && facts.suitability.length)
    lines.push(`- Suitability: ${facts.suitability.join(" ")}`);
  if (rules.price_rule) lines.push(`- Price rule: ${rules.price_rule}`);
}

const knowledge = lines.join("\n").trim();

const ours = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: practice } = await ours
  .from("practices")
  .select("id, name")
  .eq("external_id", "regent-boxly")
  .maybeSingle();
if (!practice) {
  console.error("Regent practice not found.");
  process.exit(1);
}

const { data: active } = await ours
  .from("agent_control_configs")
  .select("id, version_number, workflow_settings")
  .eq("practice_id", practice.id)
  .eq("is_active", true)
  .maybeSingle();
if (!active) {
  console.error("No active Regent config row. Run seed-agent-configs.mjs first.");
  process.exit(1);
}

const ws = active.workflow_settings ?? {};
const clientEditable = { ...(ws.clientEditable ?? {}), knowledge };
const nextWs = { ...ws, clientEditable };

const { error } = await ours
  .from("agent_control_configs")
  .update({ workflow_settings: nextWs, updated_at: new Date().toISOString() })
  .eq("id", active.id);

console.log(
  error
    ? `ERR: ${error.message}`
    : `OK: imported knowledge (${knowledge.length} chars) into ${practice.name} config v${active.version_number}`,
);

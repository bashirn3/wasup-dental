// Imports NuYu's REAL agent config from the n8n production workflow into the
// active agent_control_configs row: master prompt + scraped clinic knowledge +
// opening hours, so the dashboard Agent tab shows the live agent.
//   node --env-file=.env.local scripts/import-nuyu-agent.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const WF_PATH =
  "/Users/bashirsani/Desktop/Projects/boxly-intergations/n8n-workflows/nuyu-wf1-inbound.json";

const wf = JSON.parse(readFileSync(WF_PATH, "utf8"));
let prompt = null;
for (const node of wf.nodes ?? []) {
  const sm = node.parameters?.options?.systemMessage ?? node.parameters?.systemMessage;
  if (node.name === "AI Agent" && typeof sm === "string") {
    prompt = sm.replace(/^=/, "").trim();
    break;
  }
}
if (!prompt) {
  console.error("Could not find the AI Agent system message in the NuYu workflow.");
  process.exit(1);
}

// The website-scraped facts/pricing live inline in the prompt between these markers.
const kStart = prompt.indexOf("Clinic knowledge from website scrape:");
const kEnd = prompt.indexOf("Do not claim:");
const knowledge =
  kStart >= 0 && kEnd > kStart ? prompt.slice(kStart, kEnd).trim() : "";

const hoursMatch = prompt.match(/Opening hours:\s*([^\n]+)/i);
const openingHours = hoursMatch ? hoursMatch[1].trim() : "";

const firstMessage =
  "Hi 👋 Thanks for your interest in Invisalign at NUYU Dental & Aesthetics. What would you like to change about your smile?";

const ours = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: practice } = await ours
  .from("practices")
  .select("id, name")
  .eq("external_id", "nuyu-boxly")
  .maybeSingle();
if (!practice) {
  console.error("NuYu practice not found.");
  process.exit(1);
}

const { data: active } = await ours
  .from("agent_control_configs")
  .select("id, version_number, workflow_settings, first_message")
  .eq("practice_id", practice.id)
  .eq("is_active", true)
  .maybeSingle();
if (!active) {
  console.error("No active NuYu config row. Run seed-agent-configs.mjs first.");
  process.exit(1);
}

const ws = active.workflow_settings ?? {};
const clientEditable = {
  ...(ws.clientEditable ?? {}),
  knowledge,
  openingHours,
  treatmentFirstMessages: {
    ...((ws.clientEditable ?? {}).treatmentFirstMessages ?? {}),
    invisalign: firstMessage,
  },
};
const nextWs = { ...ws, clientEditable };

const { error } = await ours
  .from("agent_control_configs")
  .update({
    prompt,
    first_message: active.first_message || firstMessage,
    treatment_focus: ["invisalign"],
    workflow_settings: nextWs,
    updated_at: new Date().toISOString(),
  })
  .eq("id", active.id);

console.log(
  error
    ? `ERR: ${error.message}`
    : `OK: NuYu config v${active.version_number} — prompt ${prompt.length} chars, knowledge ${knowledge.length} chars, hours "${openingHours}"`,
);

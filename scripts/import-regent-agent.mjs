// Imports Regent's REAL master prompt from the n8n production workflow into the
// active agent_control_configs row, so the dashboard Agent tab shows the live agent.
//   node --env-file=.env.local scripts/import-regent-agent.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const WF_PATH =
  "/Users/bashirsani/Desktop/Projects/boxly-intergations/n8n-workflows/regent-wf1-inbound.json";

const wf = JSON.parse(readFileSync(WF_PATH, "utf8"));
let prompt = null;
for (const node of wf.nodes ?? []) {
  const sm = node.parameters?.options?.systemMessage ?? node.parameters?.systemMessage;
  if (typeof sm === "string" && sm.includes("Procedure-Aware")) {
    prompt = sm.replace(/^=/, "").trim();
    break;
  }
}
if (!prompt) {
  console.error("Could not find the Procedure-Aware system message in the workflow.");
  process.exit(1);
}

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
  .select("id, version_number")
  .eq("practice_id", practice.id)
  .eq("is_active", true)
  .maybeSingle();
if (!active) {
  console.error("No active Regent config row. Run seed-agent-configs.mjs first.");
  process.exit(1);
}

const { error } = await ours
  .from("agent_control_configs")
  .update({ prompt, updated_at: new Date().toISOString() })
  .eq("id", active.id);

console.log(
  error
    ? `ERR: ${error.message}`
    : `OK: imported real master prompt (${prompt.length} chars) into ${practice.name} config v${active.version_number}`,
);

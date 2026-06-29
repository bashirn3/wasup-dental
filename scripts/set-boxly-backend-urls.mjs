// Stores each practice's legacy boxly backend URL on its integrations row so the
// Config tab proxy (/api/boxly/*) can reach the right deployment. Idempotent.
// Run:
//   node --env-file=.env.local scripts/set-boxly-backend-urls.mjs
import { createClient } from "@supabase/supabase-js";

const ours = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const URLS = {
  "regent-boxly": "https://boxly-agent.vercel.app",
  "nuyu-boxly": "https://nuyu-boxly-agent-lyart.vercel.app",
};

for (const [externalId, backendUrl] of Object.entries(URLS)) {
  const { data: practice } = await ours
    .from("practices")
    .select("id, name")
    .eq("external_id", externalId)
    .maybeSingle();

  if (!practice?.id) {
    console.log(`SKIP ${externalId}: practice not found`);
    continue;
  }

  const { data: integration } = await ours
    .from("integrations")
    .select("id, settings")
    .eq("practice_id", practice.id)
    .eq("source_system", "boxly")
    .maybeSingle();

  if (!integration?.id) {
    console.log(`SKIP ${externalId}: boxly integration not found`);
    continue;
  }

  const settings = { ...(integration.settings ?? {}), boxlyBackendUrl: backendUrl };
  const { error } = await ours
    .from("integrations")
    .update({ settings, updated_at: new Date().toISOString() })
    .eq("id", integration.id);

  if (error) {
    console.log(`ERROR ${externalId}: ${error.message}`);
  } else {
    console.log(`OK ${practice.name} (${externalId}) -> ${backendUrl}`);
  }
}

console.log("Done.");

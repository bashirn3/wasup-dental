// Read-only reconciliation: verify wasup-dental's mirror + Activity ordering
// matches the legacy Boxly source for Regent/NuYu. No writes, no side effects.
//
// Usage: node scripts/reconcile-activity.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function loadEnv() {
  const text = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    env[match[1]] = value;
  }
  return env;
}

const env = loadEnv();
const ours = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const legacy = createClient(env.REGENT_LEGACY_SUPABASE_URL, env.REGENT_LEGACY_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const workspaces = [
  { externalId: "regent-boxly", table: "regent_dental_leads", label: "Regent" },
  { externalId: "nuyu-boxly", table: "nuyu_leads", label: "Nuyu" },
];

const TOP_N = 20;

function normName(r) {
  return (r.full_name || [r.first_name, r.last_name].filter(Boolean).join(" ") || "").trim().toLowerCase();
}

async function ourPracticeId(externalId) {
  const { data } = await ours.from("practices").select("id").eq("external_id", externalId).maybeSingle();
  return data?.id ?? null;
}

async function countOurs(practiceId) {
  const { count } = await ours.from("leads").select("id", { count: "exact", head: true }).eq("practice_id", practiceId);
  return count ?? 0;
}

async function countLegacy(table) {
  const { count } = await legacy.from(table).select("id", { count: "exact", head: true });
  return count ?? 0;
}

// Boxly's Activity order: actioned/ai_actioned, ordered by actioned_at desc nulls last.
async function legacyTop(table) {
  const { data } = await legacy
    .from(table)
    .select("boxly_lead_id, full_name, first_name, last_name, actioned_at, ai_actioned_at")
    .or("actioned.eq.true,ai_actioned.eq.true")
    .order("actioned_at", { ascending: false, nullsFirst: false })
    .limit(TOP_N);
  return data ?? [];
}

// Ours: replicate the Activity order key (actioned_at -> ai_actioned_at, nulls last).
async function ourTop(practiceId) {
  const { data } = await ours
    .from("leads")
    .select("external_id, name, external_payload, status")
    .eq("practice_id", practiceId)
    .in("status", ["engaged", "booked"])
    .limit(5000);
  const rows = (data ?? [])
    .map((r) => {
      const meta = r.external_payload?.legacy ?? {};
      const key = meta.actionedAt ?? null;
      return { external_id: r.external_id, name: (r.name || "").toLowerCase(), key };
    })
    .filter((r) => r.key);
  rows.sort((a, b) => (b.key || "").localeCompare(a.key || ""));
  return rows.slice(0, TOP_N);
}

for (const ws of workspaces) {
  const pid = await ourPracticeId(ws.externalId);
  if (!pid) {
    console.log(`${ws.label}: practice not found (skipping)`);
    continue;
  }
  const [ourCount, legacyCount, lTop, oTop] = await Promise.all([
    countOurs(pid),
    countLegacy(ws.table),
    legacyTop(ws.table),
    ourTop(pid),
  ]);

  console.log(`\n=== ${ws.label} ===`);
  console.log(`counts: ours=${ourCount} legacy=${legacyCount} diff=${ourCount - legacyCount}`);

  let matches = 0;
  for (let i = 0; i < TOP_N; i++) {
    const lname = lTop[i] ? normName(lTop[i]) : "-";
    const oname = oTop[i] ? oTop[i].name : "-";
    const same = lname === oname;
    if (same) matches++;
    console.log(`${String(i + 1).padStart(2)} ${same ? "OK " : "XX "} legacy="${lname}" ours="${oname}"`);
  }
  console.log(`activity order match (by actioned_at): ${matches}/${TOP_N}`);
}

console.log("\nDone.");

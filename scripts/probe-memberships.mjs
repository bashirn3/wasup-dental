// Read-only: lists practices and membership rows so we can see how a client
// (e.g. Asif) is wired to a practice. Run:
//   node --env-file=.env.local scripts/probe-memberships.mjs
import { createClient } from "@supabase/supabase-js";

const ours = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: practices } = await ours
  .from("practices")
  .select("id, name, external_id, source_system")
  .order("name");

console.log("PRACTICES:");
for (const p of practices ?? []) console.log(`  ${p.name}  [${p.external_id}]  ${p.id}`);

const { data: memberships, error } = await ours
  .from("memberships")
  .select("practice_id, email, clerk_user_id, role")
  .order("email");

if (error) {
  console.log("\nMEMBERSHIPS query error:", error.message);
} else {
  console.log(`\nMEMBERSHIPS (${memberships?.length ?? 0}):`);
  const byId = new Map((practices ?? []).map((p) => [p.id, p.name]));
  for (const m of memberships ?? []) {
    console.log(`  ${m.email ?? "(no email)"}  role=${m.role}  clerk=${m.clerk_user_id ?? "-"}  practice=${byId.get(m.practice_id) ?? m.practice_id}`);
  }
}

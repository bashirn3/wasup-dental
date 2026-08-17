#!/usr/bin/env node
/**
 * Remove dashboard leads that no longer exist in a practice's Leadflo feeder.
 *
 * Why this is needed: the mirror only ever writes what the feeder returns, so a
 * lead that leaves the feeder's tracked stages is never updated again and never
 * removed. Dental Aesthetica ended up with 573 such rows, frozen on the day they
 * were imported and all still labelled "new" while the patients behind them had
 * moved on to consultation or treatment. They made the dashboard read as though
 * hundreds of leads had been ignored.
 *
 * Dry run by default. Pass --apply to delete.
 *
 *   node scripts/prune-stale-leadflo-leads.mjs --practice=<uuid>
 *   node scripts/prune-stale-leadflo-leads.mjs --practice=<uuid> --before=2026-08-10 --apply
 *
 * Guards, all of which must pass before a row is touched:
 *   - the feeder page was not truncated, so "missing" cannot mean "not fetched";
 *   - the lead's external id is absent from the feeder;
 *   - the lead has no messages, so no conversation is ever destroyed;
 *   - optionally, the lead was last synced before --before.
 */

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value ?? "true"];
  }),
);

const APPLY = args.get("apply") === "true";
const PRACTICE_ID = args.get("practice");
const BEFORE = args.get("before") ?? null;

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!PRACTICE_ID) fail("pass --practice=<uuid>");
if (!SUPABASE_URL || !SERVICE_KEY) fail("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function rest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`supabase_failed:${res.status}:${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** The feeder's address comes from the same integration row the mirror uses. */
async function feederBaseUrl() {
  const rows = await rest(
    `integrations?practice_id=eq.${PRACTICE_ID}&source_system=eq.leadflo&select=settings`,
  );
  const url = rows?.[0]?.settings?.feederBaseUrl;
  if (!url) fail("no leadflo integration with a feederBaseUrl for that practice");
  return String(url).replace(/\/$/, "");
}

async function feederIds(baseUrl) {
  const key = process.env.LEADFLO_FEEDER_API_KEY;
  const res = await fetch(`${baseUrl}/api/leads${key ? "?limit=2000" : ""}`, {
    headers: key ? { "X-WF1-Key": key } : {},
    cache: "no-store",
  });
  if (!res.ok) fail(`feeder read failed: ${res.status}`);

  const body = await res.json();
  const leads = Array.isArray(body) ? body : (body.leads ?? []);
  const limit = Number(body?.limit ?? 0);

  // A full page means there may be more behind it, and treating unfetched leads
  // as deleted would wipe live rows. Refuse rather than guess.
  if (limit && leads.length >= limit) {
    fail(
      `feeder returned a full page (${leads.length} of limit ${limit}); ` +
        `set LEADFLO_FEEDER_API_KEY so the whole list can be read`,
    );
  }

  return new Set(leads.map((lead) => String(lead.patientId ?? lead.id)));
}

async function main() {
  const baseUrl = await feederBaseUrl();
  const live = await feederIds(baseUrl);

  const leads = await rest(
    `leads?practice_id=eq.${PRACTICE_ID}&select=id,external_id,name,status,last_synced_at&limit=5000`,
  );
  const messaged = new Set(
    (
      await rest(`messages?practice_id=eq.${PRACTICE_ID}&select=lead_id&limit=20000`)
    ).map((row) => row.lead_id),
  );

  const missing = leads.filter((lead) => !live.has(String(lead.external_id)));
  const keptForMessages = missing.filter((lead) => messaged.has(lead.id));
  const keptForDate = BEFORE
    ? missing.filter((lead) => !messaged.has(lead.id) && !(lead.last_synced_at < BEFORE))
    : [];
  const doomed = missing.filter(
    (lead) =>
      !messaged.has(lead.id) && (!BEFORE || lead.last_synced_at < BEFORE),
  );

  console.log(`feeder            : ${live.size} leads at ${baseUrl}`);
  console.log(`dashboard         : ${leads.length} leads`);
  console.log(`absent from feeder: ${missing.length}`);
  console.log(`  kept, has messages     : ${keptForMessages.length}`);
  if (BEFORE) console.log(`  kept, synced since ${BEFORE}: ${keptForDate.length}`);
  console.log(`  TO DELETE              : ${doomed.length}`);

  const byStatus = {};
  for (const lead of doomed) byStatus[lead.status] = (byStatus[lead.status] ?? 0) + 1;
  console.log(`status of delete set: ${JSON.stringify(byStatus)}`);

  if (!doomed.length) return;
  if (!APPLY) {
    console.log("\ndry run. re-run with --apply to delete.");
    return;
  }

  let deleted = 0;
  for (let index = 0; index < doomed.length; index += 100) {
    const chunk = doomed.slice(index, index + 100);
    await rest(`leads?id=in.(${chunk.map((lead) => lead.id).join(",")})`, { method: "DELETE" });
    deleted += chunk.length;
    console.log(`  deleted ${deleted}/${doomed.length}`);
  }

  const after = await rest(`leads?practice_id=eq.${PRACTICE_ID}&select=id&limit=5000`);
  console.log(`\ndone. dashboard now holds ${after.length} leads for this practice.`);
}

main().catch((error) => fail(error.message));

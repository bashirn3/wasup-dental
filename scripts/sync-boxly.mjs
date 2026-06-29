// Manual Boxly -> wasup mirror sync for ALL boxly integrations.
// Mirrors lib/boxly-mirror.ts (the canonical path used by the Vercel cron at
// /api/import/boxly/scheduled). Use for local/manual refreshes:
//   node --env-file=.env.local scripts/sync-boxly.mjs
import { createClient } from "@supabase/supabase-js";

const LEAD_COLUMNS =
  "boxly_lead_id, full_name, first_name, last_name, phone_e164, phone_number, email, box_name, box_stage, lead_source, lead_summary, urgency, ai_actioned, actioned, actioned_at, ai_actioned_at, conversation_count, conversation, became_lead_at, last_updated_at, scraped_at, raw_data";

const ours = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

function treatmentFromBox(boxName) {
  const v = (boxName ?? "").toLowerCase();
  if (v.includes("implant")) return "implants";
  if (v.includes("arch")) return "full_arch_implants";
  if (v.includes("composite") || v.includes("bond")) return "composites";
  if (v.includes("whiten")) return "whitening";
  if (v.includes("veneer")) return "veneers";
  if (v.includes("hygiene")) return "hygiene";
  if (v.includes("emergency")) return "emergency";
  return "invisalign";
}

function needsHuman(row) {
  const stage = (row.box_stage ?? "").toLowerCase();
  return stage.includes("human") || stage.includes("review") || stage.includes("call");
}

function normalizeLead(row, practiceId, now) {
  const externalId = row.boxly_lead_id ?? null;
  if (!externalId) return null;
  const fullName = row.full_name || [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || null;
  const aiActioned = Boolean(row.ai_actioned || row.actioned);
  return {
    practice_id: practiceId,
    name: fullName ?? "Unknown patient",
    phone: row.phone_e164 ?? row.phone_number ?? null,
    email: row.email ?? null,
    treatment: treatmentFromBox(row.box_name),
    status: aiActioned ? "engaged" : "new",
    source: row.lead_source ?? "boxly",
    source_system: "boxly",
    external_id: externalId,
    external_payload: {
      legacy: {
        boxlyLeadId: externalId,
        urgency: row.urgency ?? null,
        aiActioned: row.ai_actioned ?? null,
        actioned: row.actioned ?? null,
        actionedAt: row.actioned_at ?? null,
        aiActionedAt: row.ai_actioned_at ?? null,
        conversationCount: row.conversation_count ?? null,
        becameLeadAt: row.became_lead_at ?? null,
        lastUpdatedAt: row.last_updated_at ?? null,
        scrapedAt: row.scraped_at ?? null,
      },
      summary: row.lead_summary ?? null,
      raw: row.raw_data ?? {},
    },
    box_name: row.box_name ?? null,
    box_stage: row.box_stage ?? null,
    needs_human: needsHuman(row),
    last_synced_at: now,
    updated_at: row.became_lead_at ?? row.last_updated_at ?? row.scraped_at ?? now,
  };
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function plainText(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

async function upsertConversations(practiceId, rows) {
  const externalIds = rows.map((r) => r.boxly_lead_id).filter(Boolean);
  if (!externalIds.length) return 0;
  const leadMap = new Map();
  for (let i = 0; i < externalIds.length; i += 200) {
    const chunk = externalIds.slice(i, i + 200);
    const { data } = await ours
      .from("leads")
      .select("id, external_id")
      .eq("practice_id", practiceId)
      .eq("source_system", "boxly")
      .in("external_id", chunk);
    for (const lead of data ?? []) leadMap.set(lead.external_id, lead.id);
  }
  const messages = [];
  for (const row of rows) {
    const leadId = row.boxly_lead_id ? leadMap.get(row.boxly_lead_id) : null;
    if (!leadId) continue;
    for (const [index, message] of asArray(row.conversation).entries()) {
      const body = plainText(message.message);
      if (!body) continue;
      messages.push({
        practice_id: practiceId,
        lead_id: leadId,
        direction: message.type === "inbound" ? "inbound" : "outbound",
        body,
        ai_generated: message.type !== "inbound" && Boolean(row.ai_actioned || row.actioned),
        source_system: "boxly",
        external_id: `${row.boxly_lead_id}:${index}`,
        external_payload: {
          channel: message.channel ?? null,
          sender: message.sender ?? null,
          subject: message.subject ?? null,
          type: message.type ?? null,
        },
        created_at: message.timestamp ?? new Date().toISOString(),
      });
    }
  }
  const existing = new Set();
  const ids = messages.map((m) => m.external_id);
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data } = await ours
      .from("messages")
      .select("external_id")
      .eq("practice_id", practiceId)
      .eq("source_system", "boxly")
      .in("external_id", chunk);
    for (const r of data ?? []) existing.add(r.external_id);
  }
  const inserts = messages.filter((m) => !existing.has(m.external_id));
  let inserted = 0;
  for (let i = 0; i < inserts.length; i += 500) {
    const chunk = inserts.slice(i, i + 500);
    const { error } = await ours.from("messages").insert(chunk);
    if (!error) inserted += chunk.length;
  }
  return inserted;
}

async function syncIntegration(integration) {
  const settings = integration.settings ?? {};
  const table = settings.legacyLeadsTable;
  const url = process.env[settings.legacySupabaseUrlEnv];
  const key = process.env[settings.legacySupabaseServiceRoleKeyEnv];
  if (!table || !url || !key) {
    console.log(`SKIP ${integration.display_name}: missing table/env (${settings.legacySupabaseUrlEnv})`);
    return;
  }
  const legacy = createClient(url, key, { auth: { persistSession: false } });
  const now = new Date().toISOString();
  // PostgREST caps each read at ~1000 rows, so paginate with .range() to pull the
  // full table (one-time backfill). The 15-min cron only needs the newest page.
  const PAGE = 1000;
  let from = 0;
  let upserted = 0;
  let messages = 0;
  let sourceCount = 0;
  for (;;) {
    const { data: rows, error } = await legacy
      .from(table)
      .select(LEAD_COLUMNS)
      .order("became_lead_at", { ascending: false, nullsFirst: false })
      .range(from, from + PAGE - 1);
    if (error) {
      console.log(`ERR ${integration.display_name}: read ${error.message}`);
      return;
    }
    const batch = rows ?? [];
    if (!batch.length) break;
    sourceCount += batch.length;
    const records = batch.map((r) => normalizeLead(r, integration.practice_id, now)).filter(Boolean);
    for (let i = 0; i < records.length; i += 500) {
      const chunk = records.slice(i, i + 500);
      const { error: upErr } = await ours
        .from("leads")
        .upsert(chunk, { onConflict: "practice_id,source_system,external_id" });
      if (upErr) {
        console.log(`ERR ${integration.display_name}: upsert ${upErr.message}`);
        return;
      }
      upserted += chunk.length;
    }
    messages += await upsertConversations(integration.practice_id, batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }
  const count = sourceCount;
  await ours
    .from("integrations")
    .update({ last_synced_at: now, updated_at: now, status: "connected" })
    .eq("id", integration.id);
  await ours.from("practices").update({ last_synced_at: now }).eq("id", integration.practice_id);
  console.log(
    `OK ${integration.display_name}: source=${count} leads_upserted=${upserted} messages_inserted=${messages}`,
  );
}

const { data: integrations, error } = await ours
  .from("integrations")
  .select("id, practice_id, display_name, settings")
  .eq("source_system", "boxly");
if (error) {
  console.error("integration lookup failed:", error.message);
  process.exit(1);
}
for (const integration of integrations ?? []) {
  await syncIntegration(integration);
}
console.log("done");

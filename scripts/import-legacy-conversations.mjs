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
  { externalId: "regent-boxly", table: "regent_dental_leads", sessionPrefix: "uk_004_" },
  { externalId: "nuyu-boxly", table: "nuyu_leads", sessionPrefix: "uk_007_" },
];

function plainText(value) {
  if (!value) return "";
  return String(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
}

function parseChatHistoryMessage(value) {
  if (!value) return { role: null, content: "" };
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return { role: null, content: "" };
    }
  }
  if (!parsed || typeof parsed !== "object") return { role: null, content: "" };
  const role = typeof parsed.type === "string" ? parsed.type : null;
  const content = typeof parsed.content === "string"
    ? parsed.content
    : parsed.data && typeof parsed.data === "object" && typeof parsed.data.content === "string"
      ? parsed.data.content
      : "";
  return { role, content: content.trim() };
}

async function loadChatHistoryByLead(sessionPrefix) {
  const byLead = new Map();
  if (!sessionPrefix) return byLead;
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data } = await legacy
      .from("chat_history")
      .select("id, session_id, message, timestamp")
      .like("session_id", `${sessionPrefix}%`)
      .order("id", { ascending: true })
      .range(from, from + page - 1);
    if (!data || data.length === 0) break;

    for (const row of data) {
      if (!row.session_id?.startsWith(sessionPrefix)) continue;
      const leadExternalId = row.session_id.slice(sessionPrefix.length);
      const parsed = parseChatHistoryMessage(row.message);
      if (!parsed.content) continue;
      const entries = byLead.get(leadExternalId) ?? [];
      entries.push({
        id: row.id,
        role: parsed.role,
        content: parsed.content,
        timestamp: row.timestamp,
      });
      byLead.set(leadExternalId, entries);
    }

    if (data.length < page) break;
    from += page;
  }
  return byLead;
}

function classifyAiGenerated(msg, row, aiEntries, body) {
  if (msg.type !== "outbound" && msg.type !== "template") {
    return { aiGenerated: false, attribution: null };
  }

  const normalizedBody = normalizeText(body);
  if (!normalizedBody) return { aiGenerated: false, attribution: null };

  const matched = aiEntries.some((entry) => {
    if (entry.role !== "ai") return false;
    const normalizedAi = normalizeText(entry.content);
    return normalizedAi && (normalizedAi.includes(normalizedBody) || normalizedBody.includes(normalizedAi));
  });
  if (matched) return { aiGenerated: true, attribution: "chat_history_match" };

  if (!row.ai_actioned || !row.ai_actioned_at || !msg.timestamp) {
    return { aiGenerated: false, attribution: null };
  }

  const messageMs = Date.parse(msg.timestamp);
  const actionedMs = Date.parse(row.ai_actioned_at);
  if (!Number.isFinite(messageMs) || !Number.isFinite(actionedMs)) {
    return { aiGenerated: false, attribution: null };
  }

  return Math.abs(messageMs - actionedMs) <= 90_000
    ? { aiGenerated: true, attribution: "ai_actioned_time" }
    : { aiGenerated: false, attribution: null };
}

async function loadLeadIdMap(practiceId) {
  const map = new Map();
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data } = await ours
      .from("leads")
      .select("id, external_id")
      .eq("practice_id", practiceId)
      .eq("source_system", "boxly")
      .not("external_id", "is", null)
      .range(from, from + page - 1);
    if (!data || data.length === 0) break;
    for (const r of data) map.set(r.external_id, r.id);
    if (data.length < page) break;
    from += page;
  }
  return map;
}

async function loadExistingMessageMap(practiceId) {
  const map = new Map();
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data } = await ours
      .from("messages")
      .select("id, external_id")
      .eq("practice_id", practiceId)
      .eq("source_system", "boxly")
      .not("external_id", "is", null)
      .range(from, from + page - 1);
    if (!data || data.length === 0) break;
    for (const r of data) map.set(r.external_id, r.id);
    if (data.length < page) break;
    from += page;
  }
  return map;
}

async function flush(buffer, counters) {
  if (buffer.length === 0) return;

  const inserts = [];
  const updates = [];
  for (const record of buffer) {
    const { __existingId, ...message } = record;
    if (__existingId) updates.push({ id: __existingId, message });
    else inserts.push(message);
  }

  if (inserts.length) {
    const { error } = await ours.from("messages").insert(inserts);
    if (!error) {
      counters.inserted += inserts.length;
    } else {
      for (const record of inserts) {
        const { error: rowErr } = await ours.from("messages").insert(record);
        if (!rowErr) counters.inserted += 1;
        else counters.skipped += 1;
      }
    }
  }

  for (const update of updates) {
    const { error } = await ours.from("messages").update(update.message).eq("id", update.id);
    if (!error) counters.updated += 1;
    else counters.skipped += 1;
  }

  buffer.length = 0;
}

async function importConversations(ws) {
  const practice = await ours
    .from("practices")
    .select("id")
    .eq("external_id", ws.externalId)
    .maybeSingle();
  const practiceId = practice.data?.id;
  if (!practiceId) {
    console.log(`${ws.externalId}: practice not found, skipping`);
    return;
  }

  const leadIdMap = await loadLeadIdMap(practiceId);
  const existing = await loadExistingMessageMap(practiceId);
  const chatHistoryByLead = await loadChatHistoryByLead(ws.sessionPrefix);
  const counters = { inserted: 0, updated: 0, skipped: 0 };
  const buffer = [];
  const pageSize = 500;
  let from = 0;
  const startedAt = new Date().toISOString();
  const run = await ours
    .from("sync_runs")
    .insert({
      practice_id: practiceId,
      source_system: "boxly",
      sync_type: "legacy_conversations",
      status: "started",
      metadata: { externalId: ws.externalId, table: ws.table, sessionPrefix: ws.sessionPrefix },
    })
    .select("id")
    .maybeSingle();
  const runId = run.data?.id ?? null;

  for (;;) {
    const { data: rows, error } = await legacy
      .from(ws.table)
      .select("boxly_lead_id, conversation, ai_actioned, ai_actioned_at")
      .gt("conversation_count", 0)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      console.log(`${ws.externalId}: read error at ${from}: ${error.message}`);
      break;
    }
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      const leadExternalId = row.boxly_lead_id;
      const localLeadId = leadExternalId ? leadIdMap.get(leadExternalId) : null;
      if (!localLeadId) continue;

      const messages = asArray(row.conversation);
      const aiEntries = chatHistoryByLead.get(leadExternalId) ?? [];
      messages.forEach((msg, index) => {
        if (!msg || typeof msg !== "object") return;
        const body = plainText(msg.message);
        if (!body) {
          counters.skipped += 1;
          return;
        }
        const externalId = `${leadExternalId}:${index}`;
        const { aiGenerated, attribution } = classifyAiGenerated(msg, row, aiEntries, body);
        const hasExisting = existing.has(externalId);
        const existingId = existing.get(externalId);
        if (hasExisting && !existingId) return; // duplicate already queued in this run
        if (existingId && !aiGenerated) return; // the first import already has the non-AI transcript
        buffer.push({
          ...(existingId ? { __existingId: existingId } : {}),
          practice_id: practiceId,
          lead_id: localLeadId,
          direction: msg.type === "inbound" ? "inbound" : "outbound",
          body,
          ai_generated: aiGenerated,
          source_system: "boxly",
          external_id: externalId,
          external_payload: {
            channel: msg.channel ?? null,
            sender: msg.sender ?? null,
            subject: msg.subject ?? null,
            type: msg.type ?? null,
            aiAttribution: attribution,
          },
          created_at: msg.timestamp ?? new Date().toISOString(),
        });
        if (!existingId) existing.set(externalId, null);
      });

      if (buffer.length >= 500) await flush(buffer, counters, ws.externalId);
    }

    console.log(`${ws.externalId}: scanned ${from + rows.length} rows...`);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  await flush(buffer, counters, ws.externalId);
  const finishedAt = new Date().toISOString();
  await Promise.all([
    ours
      .from("integrations")
      .update({ last_synced_at: finishedAt, status: "connected", updated_at: finishedAt })
      .eq("practice_id", practiceId)
      .eq("source_system", "boxly"),
    ours
      .from("practices")
      .update({ last_synced_at: finishedAt, updated_at: finishedAt })
      .eq("id", practiceId),
    runId
      ? ours
          .from("sync_runs")
          .update({
            status: "completed",
            started_at: startedAt,
            finished_at: finishedAt,
            inserted_count: counters.inserted,
            updated_count: counters.updated,
            skipped_count: counters.skipped,
          })
          .eq("id", runId)
      : Promise.resolve(),
  ]);
  console.log(
    `${ws.externalId}: messages inserted ${counters.inserted}, updated ${counters.updated}, skipped ${counters.skipped} (practice ${practiceId})`,
  );
}

for (const ws of workspaces) {
  try {
    await importConversations(ws);
  } catch (error) {
    console.log(`${ws.externalId}: failed - ${error.message}`);
  }
}

console.log("Done.");

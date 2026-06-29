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
  {
    orgName: "Regent Dental",
    slug: "regent",
    practiceName: "Regent Dental",
    externalId: "regent-boxly",
    display: "Regent Boxly",
    table: "regent_dental_leads",
    settings: {
      configNamespace: "regent",
      legacyLeadsTable: "regent_dental_leads",
      legacySupabaseUrlEnv: "REGENT_LEGACY_SUPABASE_URL",
      legacySupabaseServiceRoleKeyEnv: "REGENT_LEGACY_SUPABASE_SERVICE_ROLE_KEY",
      legacyApiBaseEnv: "REGENT_BOXLY_API_BASE",
      legacyEmailEnv: "REGENT_BOXLY_EMAIL",
      legacyPasswordEnv: "REGENT_BOXLY_PASSWORD",
      chatHistorySessionPrefix: "uk_004_",
    },
  },
  {
    orgName: "Nuyu Dental",
    slug: "nuyu",
    practiceName: "Nuyu Dental",
    externalId: "nuyu-boxly",
    display: "Nuyu Boxly",
    table: "nuyu_leads",
    settings: {
      configNamespace: "nuyu",
      legacyLeadsTable: "nuyu_leads",
      legacySupabaseUrlEnv: "REGENT_LEGACY_SUPABASE_URL",
      legacySupabaseServiceRoleKeyEnv: "REGENT_LEGACY_SUPABASE_SERVICE_ROLE_KEY",
      chatHistorySessionPrefix: "uk_007_",
    },
  },
];

const SELECT_COLUMNS =
  "boxly_lead_id, full_name, first_name, last_name, phone_e164, phone_number, email, box_name, box_stage, lead_source, lead_summary, urgency, ai_actioned, actioned, conversation_count, became_lead_at, last_updated_at, scraped_at, raw_data";

function normalize(row) {
  const fullName =
    row.full_name || [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || null;
  const status = row.actioned || row.ai_actioned ? "engaged" : "new";
  return {
    externalId: row.boxly_lead_id ?? null,
    fullName,
    phone: row.phone_e164 ?? row.phone_number ?? null,
    email: row.email ?? null,
    treatment: row.box_name ?? null,
    status,
    source: row.lead_source ?? "boxly",
    boxName: row.box_name ?? null,
    boxStage: row.box_stage ?? null,
    lastSyncedAt: row.scraped_at ?? row.last_updated_at ?? null,
  };
}

function buildExternalPayload(row) {
  return {
    legacy: {
      boxlyLeadId: row.boxly_lead_id ?? null,
      urgency: row.urgency ?? null,
      aiActioned: row.ai_actioned ?? null,
      actioned: row.actioned ?? null,
      conversationCount: row.conversation_count ?? null,
      becameLeadAt: row.became_lead_at ?? null,
      lastUpdatedAt: row.last_updated_at ?? null,
      scrapedAt: row.scraped_at ?? null,
    },
    raw: row.raw_data ?? {},
  };
}

async function ensurePractice(ws) {
  const existing = await ours
    .from("practices")
    .select("id")
    .eq("external_id", ws.externalId)
    .maybeSingle();
  let practiceId = existing.data?.id ?? null;

  if (!practiceId) {
    let org = (await ours.from("organizations").select("id").eq("slug", ws.slug).maybeSingle()).data;
    if (!org) {
      org = (
        await ours.from("organizations").insert({ name: ws.orgName, slug: ws.slug }).select("id").single()
      ).data;
    }
    const created = await ours
      .from("practices")
      .insert({
        organization_id: org?.id ?? null,
        name: ws.practiceName,
        status: "review",
        integration_mode: "legacy_mirror",
        native_runtime_enabled: false,
        source_system: "boxly",
        external_id: ws.externalId,
        whatsapp_status: "connected",
        external_payload: { seededFrom: "import_script" },
      })
      .select("id")
      .single();
    if (created.error) throw new Error(`create practice failed: ${created.error.message}`);
    practiceId = created.data.id;
  }

  await ours
    .from("integrations")
    .upsert(
      {
        practice_id: practiceId,
        source_system: "boxly",
        display_name: ws.display,
        mode: "legacy_mirror",
        status: "connected",
        settings: ws.settings,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "practice_id,source_system" },
    );

  return practiceId;
}

async function importWorkspace(ws) {
  const practiceId = await ensurePractice(ws);
  const pageSize = 1000;
  let from = 0;
  let upserted = 0;
  let skipped = 0;
  const now = new Date().toISOString();
  const run = await ours
    .from("sync_runs")
    .insert({
      practice_id: practiceId,
      source_system: "boxly",
      sync_type: "legacy_leads",
      status: "started",
      metadata: { workspace: ws.slug, table: ws.table },
    })
    .select("id")
    .maybeSingle();
  const runId = run.data?.id ?? null;

  for (;;) {
    const { data: rows, error } = await legacy
      .from(ws.table)
      .select(SELECT_COLUMNS)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      console.log(`${ws.display}: read error at offset ${from}: ${error.message}`);
      break;
    }
    if (!rows || rows.length === 0) break;

    const byExternalId = new Map();
    for (const row of rows) {
      const n = normalize(row);
      if (!n.externalId) {
        skipped += 1;
        continue;
      }
      byExternalId.set(n.externalId, {
        practice_id: practiceId,
        name: n.fullName ?? "Unknown patient",
        phone: n.phone,
        email: n.email,
        treatment: n.treatment,
        status: n.status,
        source: n.source,
        source_system: "boxly",
        external_id: n.externalId,
        external_payload: buildExternalPayload(row),
        box_name: n.boxName,
        box_stage: n.boxStage,
        needs_human: false,
        last_synced_at: n.lastSyncedAt ?? now,
        updated_at: now,
      });
    }

    const records = [...byExternalId.values()];
    for (let i = 0; i < records.length; i += 500) {
      const chunk = records.slice(i, i + 500);
      const { error: upsertErr } = await ours
        .from("leads")
        .upsert(chunk, { onConflict: "practice_id,source_system,external_id" });
      if (!upsertErr) {
        upserted += chunk.length;
        continue;
      }
      // Fall back row-by-row so one malformed legacy row does not block the sync.
      for (const record of chunk) {
        const { error: rowErr } = await ours
          .from("leads")
          .upsert(record, { onConflict: "practice_id,source_system,external_id" });
        if (!rowErr) {
          upserted += 1;
        } else {
          skipped += 1;
        }
      }
    }

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  await Promise.all([
    ours
      .from("integrations")
      .update({ last_synced_at: now, status: "connected", updated_at: now })
      .eq("practice_id", practiceId)
      .eq("source_system", "boxly"),
    ours
      .from("practices")
      .update({ last_synced_at: now, updated_at: now })
      .eq("id", practiceId),
    runId
      ? ours
          .from("sync_runs")
          .update({
            status: "completed",
            finished_at: now,
            updated_count: upserted,
            skipped_count: skipped,
          })
          .eq("id", runId)
      : Promise.resolve(),
  ]);

  console.log(`${ws.display}: upserted ${upserted}, skipped ${skipped} (practice ${practiceId})`);
}

for (const ws of workspaces) {
  try {
    await importWorkspace(ws);
  } catch (error) {
    console.log(`${ws.display}: failed - ${error.message}`);
  }
}

console.log("Done.");

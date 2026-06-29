import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";

type SupabaseResult<T> = {
  data: T | null;
  error: { code?: string; message: string } | null;
  count?: number | null;
};

type IntegrationRow = {
  id: string;
  practice_id: string;
  source_system: string;
  display_name: string;
  settings: Record<string, unknown> | null;
};

type BoxlyLeadRow = {
  boxly_lead_id?: string | null;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone_e164?: string | null;
  phone_number?: string | null;
  email?: string | null;
  box_name?: string | null;
  box_stage?: string | null;
  lead_source?: string | null;
  lead_summary?: string | null;
  urgency?: string | null;
  ai_actioned?: boolean | null;
  actioned?: boolean | null;
  actioned_at?: string | null;
  ai_actioned_at?: string | null;
  conversation_count?: number | null;
  conversation?: unknown;
  became_lead_at?: string | null;
  last_updated_at?: string | null;
  scraped_at?: string | null;
  raw_data?: Record<string, unknown> | null;
};

type LegacyConversationMessage = {
  type?: string | null;
  sender?: string | null;
  channel?: string | null;
  message?: string | null;
  subject?: string | null;
  timestamp?: string | null;
};

type BoxlySettings = {
  configNamespace?: string;
  legacyLeadsTable: string;
  legacySupabaseUrlEnv: string;
  legacySupabaseServiceRoleKeyEnv: string;
  chatHistorySessionPrefix?: string;
};

export type BoxlyMirrorOptions = {
  integrationId?: string | null;
  limit?: number;
  includeConversations?: boolean;
};

export type BoxlyMirrorResult = {
  practiceId: string;
  integrationId: string;
  displayName: string;
  table: string;
  leadsUpserted: number;
  messagesUpserted: number;
  skipped: number;
  configKeysMirrored: number;
  sourceCount: number | null;
};

const LEAD_COLUMNS =
  "boxly_lead_id, full_name, first_name, last_name, phone_e164, phone_number, email, box_name, box_stage, lead_source, lead_summary, urgency, ai_actioned, actioned, actioned_at, ai_actioned_at, conversation_count, conversation, became_lead_at, last_updated_at, scraped_at, raw_data";

export async function mirrorBoxlyPractice(
  practiceId: string,
  options: BoxlyMirrorOptions = {},
): Promise<BoxlyMirrorResult> {
  const ours = supabaseAdmin();
  if (!ours) throw new Error("storage_unavailable");

  const integration = await loadIntegration(ours, practiceId, options.integrationId ?? null);
  const settings = normalizeSettings(integration.settings);
  const legacy = createClient(
    process.env[settings.legacySupabaseUrlEnv] ?? "",
    process.env[settings.legacySupabaseServiceRoleKeyEnv] ?? "",
    { auth: { persistSession: false } },
  );

  if (!process.env[settings.legacySupabaseUrlEnv] || !process.env[settings.legacySupabaseServiceRoleKeyEnv]) {
    throw new Error("legacy_source_env_missing");
  }

  const startedAt = new Date().toISOString();
  const run = await ours
    .from("sync_runs")
    .insert({
      practice_id: practiceId,
      source_system: "boxly",
      sync_type: options.includeConversations ? "boxly_leads_and_conversations" : "boxly_leads",
      status: "started",
      metadata: { integrationId: integration.id, table: settings.legacyLeadsTable },
    })
    .select("id")
    .maybeSingle();

  let leadsUpserted = 0;
  let messagesUpserted = 0;
  let skipped = 0;
  let configKeysMirrored = 0;
  let sourceCount: number | null = null;

  try {
    const limit = clampLimit(options.limit);
    const configSnapshot = await loadLegacyConfig(legacy, settings.configNamespace);
    configKeysMirrored = Object.keys(configSnapshot.values).length;
    const { rows, count } = await loadLegacyLeads(legacy, settings.legacyLeadsTable, limit);
    sourceCount = count;
    const now = new Date().toISOString();
    const leadRecords = rows
      .map((row) => normalizeLead(row, practiceId, now))
      .filter((row): row is NonNullable<ReturnType<typeof normalizeLead>> => {
        if (row) return true;
        skipped += 1;
        return false;
      });

    for (let index = 0; index < leadRecords.length; index += 500) {
      const chunk = leadRecords.slice(index, index + 500);
      const { error } = await ours
        .from("leads")
        .upsert(chunk, { onConflict: "practice_id,source_system,external_id" });
      if (error) throw new Error(`lead_upsert_failed:${error.code ?? error.message}`);
      leadsUpserted += chunk.length;
    }

    if (options.includeConversations) {
      messagesUpserted = await upsertConversations(ours, practiceId, rows);
    }

    await finishSync(ours, {
      runId: run.data?.id ?? null,
      practiceId,
      integrationId: integration.id,
      status: "completed",
      startedAt,
      inserted: leadsUpserted,
      updated: messagesUpserted,
      skipped,
      errorMessage: null,
      settingsPatch: {
        ...(integration.settings ?? {}),
        lastConfigSnapshot: configSnapshot,
      },
    });

    return {
      practiceId,
      integrationId: integration.id,
      displayName: integration.display_name,
      table: settings.legacyLeadsTable,
      leadsUpserted,
      messagesUpserted,
      skipped,
      configKeysMirrored,
      sourceCount,
    };
  } catch (error) {
    await finishSync(ours, {
      runId: run.data?.id ?? null,
      practiceId,
      integrationId: integration.id,
      status: "error",
      startedAt,
      inserted: leadsUpserted,
      updated: messagesUpserted,
      skipped,
      errorMessage: error instanceof Error ? error.message : String(error),
      settingsPatch: null,
    });
    throw error;
  }
}

async function loadIntegration(
  supabase: SupabaseClient,
  practiceId: string,
  integrationId: string | null,
) {
  let query = supabase
    .from("integrations")
    .select("id, practice_id, source_system, display_name, settings")
    .eq("practice_id", practiceId);

  query = integrationId ? query.eq("id", integrationId) : query.eq("source_system", "boxly").limit(1);

  const { data, error } = (await query.maybeSingle()) as SupabaseResult<IntegrationRow>;
  if (error) throw new Error(`integration_lookup_failed:${error.code ?? error.message}`);
  if (!data) throw new Error("boxly_integration_not_found");
  return data;
}

function normalizeSettings(settings: Record<string, unknown> | null): BoxlySettings {
  const legacyLeadsTable = typeof settings?.legacyLeadsTable === "string" ? settings.legacyLeadsTable : "";
  const legacySupabaseUrlEnv =
    typeof settings?.legacySupabaseUrlEnv === "string" ? settings.legacySupabaseUrlEnv : "";
  const legacySupabaseServiceRoleKeyEnv =
    typeof settings?.legacySupabaseServiceRoleKeyEnv === "string"
      ? settings.legacySupabaseServiceRoleKeyEnv
      : "";
  if (!/^[a-zA-Z0-9_]+$/.test(legacyLeadsTable)) throw new Error("invalid_legacy_leads_table");
  if (!/^[A-Z0-9_]+$/.test(legacySupabaseUrlEnv)) throw new Error("invalid_legacy_url_env");
  if (!/^[A-Z0-9_]+$/.test(legacySupabaseServiceRoleKeyEnv)) {
    throw new Error("invalid_legacy_key_env");
  }

  return {
    configNamespace: typeof settings?.configNamespace === "string" ? settings.configNamespace : undefined,
    legacyLeadsTable,
    legacySupabaseUrlEnv,
    legacySupabaseServiceRoleKeyEnv,
    chatHistorySessionPrefix:
      typeof settings?.chatHistorySessionPrefix === "string" ? settings.chatHistorySessionPrefix : undefined,
  };
}

async function loadLegacyConfig(client: SupabaseClient, namespace: string | undefined) {
  if (!namespace) return { namespace: null, values: {}, updatedAt: null };
  const { data, error } = (await client
    .from("scraper_config")
    .select("key, value, updated_at")
    .like("key", `${namespace}:%`)) as SupabaseResult<Array<{ key: string; value: string; updated_at: string | null }>>;

  if (error) return { namespace, values: {}, updatedAt: null, error: error.code ?? error.message };

  const values: Record<string, string> = {};
  let updatedAt: string | null = null;
  for (const row of data ?? []) {
    const key = row.key.slice(`${namespace}:`.length);
    values[key] = row.value;
    if (row.updated_at && (!updatedAt || row.updated_at > updatedAt)) updatedAt = row.updated_at;
  }
  return { namespace, values, updatedAt };
}

async function loadLegacyLeads(client: SupabaseClient, table: string, limit: number) {
  const { data, error, count } = (await client
    .from(table)
    .select(LEAD_COLUMNS, { count: "exact" })
    .order("last_updated_at", { ascending: false, nullsFirst: false })
    .limit(limit)) as SupabaseResult<BoxlyLeadRow[]>;

  if (error) throw new Error(`legacy_leads_read_failed:${error.code ?? error.message}`);
  return { rows: data ?? [], count: count ?? null };
}

function normalizeLead(row: BoxlyLeadRow, practiceId: string, now: string) {
  const externalId = row.boxly_lead_id ?? null;
  if (!externalId) return null;
  const fullName =
    row.full_name || [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || null;
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
    last_synced_at: row.scraped_at ?? row.last_updated_at ?? now,
    updated_at: now,
  };
}

async function upsertConversations(
  supabase: SupabaseClient,
  practiceId: string,
  rows: BoxlyLeadRow[],
) {
  const externalIds = rows.map((row) => row.boxly_lead_id).filter(Boolean) as string[];
  if (!externalIds.length) return 0;

  const leadMap = new Map<string, string>();
  for (let index = 0; index < externalIds.length; index += 200) {
    const chunk = externalIds.slice(index, index + 200);
    const { data, error } = (await supabase
      .from("leads")
      .select("id, external_id")
      .eq("practice_id", practiceId)
      .eq("source_system", "boxly")
      .in("external_id", chunk)) as SupabaseResult<Array<{ id: string; external_id: string }>>;
    if (error) throw new Error(`lead_message_lookup_failed:${error.code ?? error.message}`);
    for (const lead of data ?? []) leadMap.set(lead.external_id, lead.id);
  }
  const messages = [];
  for (const row of rows) {
    const leadExternalId = row.boxly_lead_id;
    const leadId = leadExternalId ? leadMap.get(leadExternalId) : null;
    if (!leadExternalId || !leadId) continue;

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
        external_id: `${leadExternalId}:${index}`,
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

  const existing = new Set<string>();
  const messageExternalIds = messages.map((message) => message.external_id);
  for (let index = 0; index < messageExternalIds.length; index += 100) {
    const chunk = messageExternalIds.slice(index, index + 100);
    const { data, error } = (await supabase
      .from("messages")
      .select("external_id")
      .eq("practice_id", practiceId)
      .eq("source_system", "boxly")
      .in("external_id", chunk)) as SupabaseResult<Array<{ external_id: string }>>;
    if (error) throw new Error(`message_lookup_failed:${error.code ?? error.message}`);
    for (const row of data ?? []) existing.add(row.external_id);
  }

  const inserts = messages.filter((message) => !existing.has(message.external_id));
  let inserted = 0;
  for (let index = 0; index < inserts.length; index += 500) {
    const chunk = inserts.slice(index, index + 500);
    const { error } = await supabase.from("messages").insert(chunk);
    if (!error) {
      inserted += chunk.length;
      continue;
    }
    for (const message of chunk) {
      const { error: rowError } = await supabase.from("messages").insert(message);
      if (!rowError) inserted += 1;
    }
  }
  return inserted;
}

async function finishSync(
  supabase: SupabaseClient,
  args: {
    runId: string | null;
    practiceId: string;
    integrationId: string;
    status: "completed" | "error";
    startedAt: string;
    inserted: number;
    updated: number;
    skipped: number;
    errorMessage: string | null;
    settingsPatch: Record<string, unknown> | null;
  },
) {
  const finishedAt = new Date().toISOString();
  await Promise.all([
    supabase
      .from("integrations")
      .update({
        last_synced_at: finishedAt,
        updated_at: finishedAt,
        status: args.status === "completed" ? "connected" : "error",
        ...(args.settingsPatch ? { settings: args.settingsPatch } : {}),
      })
      .eq("id", args.integrationId),
    supabase.from("practices").update({ last_synced_at: finishedAt }).eq("id", args.practiceId),
    args.runId
      ? supabase
          .from("sync_runs")
          .update({
            status: args.status,
            started_at: args.startedAt,
            finished_at: finishedAt,
            inserted_count: args.inserted,
            updated_count: args.updated,
            skipped_count: args.skipped,
            error_message: args.errorMessage,
          })
          .eq("id", args.runId)
      : Promise.resolve(),
  ]);
}

function clampLimit(value: unknown) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 5000) : 1000;
}

function asArray(value: unknown): LegacyConversationMessage[] {
  if (Array.isArray(value)) return value as LegacyConversationMessage[];
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as LegacyConversationMessage[]) : [];
  } catch {
    return [];
  }
}

function plainText(value: string | null | undefined) {
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

function needsHuman(row: BoxlyLeadRow) {
  const stage = (row.box_stage ?? "").toLowerCase();
  return stage.includes("human") || stage.includes("review") || stage.includes("call");
}

function treatmentFromBox(boxName: string | null | undefined) {
  const value = (boxName ?? "").toLowerCase();
  if (value.includes("implant")) return "implants";
  if (value.includes("arch")) return "full_arch_implants";
  if (value.includes("composite") || value.includes("bond")) return "composites";
  if (value.includes("whiten")) return "whitening";
  if (value.includes("veneer")) return "veneers";
  if (value.includes("hygiene")) return "hygiene";
  if (value.includes("emergency")) return "emergency";
  return "invisalign";
}

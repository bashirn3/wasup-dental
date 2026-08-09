import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Leadflo lead mirror.
 *
 * Dental Aesthetica's leads are scraped from Leadflo into the WF-1 feeder, which
 * is the only place they exist. This copies them into the dashboard so a DA lead
 * looks like a Regent one: visible in the UI, and findable by phone number so the
 * inbound agent knows who it is talking to.
 *
 * The feeder is the source of truth. Nothing here writes back to it, and nothing
 * here contacts anybody.
 */

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

/** One lead as the feeder's `GET /api/leads` serialises it. */
type FeederLead = {
  patientId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  phone?: string | null;
  /** Feeder-resolved E.164. Absent when the raw number could not be resolved. */
  phoneE164?: string | null;
  msisdn?: string | null;
  email?: string | null;
  treatmentType?: string | null;
  source?: string | null;
  stage?: string | null;
  dueDate?: string | null;
  labels?: unknown;
  isTestName?: boolean | null;
  status?: string | null;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  outboundStatus?: string | null;
  outboundSentAt?: string | null;
};

type LeadfloSettings = {
  feederBaseUrl: string;
  feederApiKeyEnv: string;
};

export type LeadfloMirrorOptions = {
  integrationId?: string | null;
  limit?: number;
};

export type LeadfloMirrorResult = {
  practiceId: string;
  integrationId: string;
  displayName: string;
  feederBaseUrl: string;
  leadsUpserted: number;
  skipped: number;
  withoutUsablePhone: number;
  sourceCount: number;
};

export type LeadfloPreviewResult = {
  practiceId: string;
  integrationId: string;
  displayName: string;
  feederBaseUrl: string;
  sourceCount: number;
  wouldInsert: number;
  wouldUpdate: number;
  skipped: number;
  withoutUsablePhone: number;
  treatments: Record<string, number>;
  stages: Record<string, number>;
  sample: Array<{
    externalId: string;
    name: string;
    phone: string | null;
    treatment: string;
    stage: string | null;
    status: string;
    alreadyPresent: boolean;
  }>;
};

const SOURCE_SYSTEM = "leadflo";

export async function previewLeadfloPractice(
  practiceId: string,
  options: LeadfloMirrorOptions = {},
): Promise<LeadfloPreviewResult> {
  const ours = supabaseAdmin();
  if (!ours) throw new Error("storage_unavailable");

  const integration = await loadIntegration(ours, practiceId, options.integrationId ?? null);
  const settings = normalizeSettings(integration.settings);
  const rows = await fetchFeederLeads(settings, clampLimit(options.limit));

  const now = new Date().toISOString();
  let skipped = 0;
  const records = rows
    .map((row) => normalizeLead(row, practiceId, now))
    .filter((row): row is NonNullable<ReturnType<typeof normalizeLead>> => {
      if (row) return true;
      skipped += 1;
      return false;
    });

  const existing = await loadExistingExternalIds(
    ours,
    practiceId,
    records.map((record) => record.external_id),
  );

  const treatments: Record<string, number> = {};
  const stages: Record<string, number> = {};
  for (const record of records) {
    treatments[record.treatment] = (treatments[record.treatment] ?? 0) + 1;
    const stage = record.box_stage ?? "(none)";
    stages[stage] = (stages[stage] ?? 0) + 1;
  }

  return {
    practiceId,
    integrationId: integration.id,
    displayName: integration.display_name,
    feederBaseUrl: settings.feederBaseUrl,
    sourceCount: rows.length,
    wouldInsert: records.filter((record) => !existing.has(record.external_id)).length,
    wouldUpdate: records.filter((record) => existing.has(record.external_id)).length,
    skipped,
    withoutUsablePhone: records.filter((record) => !record.phone).length,
    treatments,
    stages,
    sample: records.slice(0, 10).map((record) => ({
      externalId: record.external_id,
      name: record.name,
      phone: record.phone,
      treatment: record.treatment,
      stage: record.box_stage,
      status: record.status,
      alreadyPresent: existing.has(record.external_id),
    })),
  };
}

export async function mirrorLeadfloPractice(
  practiceId: string,
  options: LeadfloMirrorOptions = {},
): Promise<LeadfloMirrorResult> {
  const ours = supabaseAdmin();
  if (!ours) throw new Error("storage_unavailable");

  const integration = await loadIntegration(ours, practiceId, options.integrationId ?? null);
  const settings = normalizeSettings(integration.settings);

  const startedAt = new Date().toISOString();
  const run = await ours
    .from("sync_runs")
    .insert({
      practice_id: practiceId,
      source_system: SOURCE_SYSTEM,
      sync_type: "leadflo_leads",
      status: "started",
      metadata: { integrationId: integration.id, feederBaseUrl: settings.feederBaseUrl },
    })
    .select("id")
    .maybeSingle();

  let leadsUpserted = 0;
  let skipped = 0;
  let sourceCount = 0;

  try {
    const rows = await fetchFeederLeads(settings, clampLimit(options.limit));
    sourceCount = rows.length;

    const now = new Date().toISOString();
    const records = rows
      .map((row) => normalizeLead(row, practiceId, now))
      .filter((row): row is NonNullable<ReturnType<typeof normalizeLead>> => {
        if (row) return true;
        skipped += 1;
        return false;
      });

    for (let index = 0; index < records.length; index += 500) {
      const chunk = records.slice(index, index + 500);
      const { error } = await ours
        .from("leads")
        .upsert(chunk, { onConflict: "practice_id,source_system,external_id" });
      if (error) throw new Error(`lead_upsert_failed:${error.code ?? error.message}`);
      leadsUpserted += chunk.length;
    }

    await finishSync(ours, {
      runId: run.data?.id ?? null,
      practiceId,
      integrationId: integration.id,
      status: "completed",
      startedAt,
      inserted: leadsUpserted,
      skipped,
      errorMessage: null,
    });

    return {
      practiceId,
      integrationId: integration.id,
      displayName: integration.display_name,
      feederBaseUrl: settings.feederBaseUrl,
      leadsUpserted,
      skipped,
      withoutUsablePhone: records.filter((record) => !record.phone).length,
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
      skipped,
      errorMessage: error instanceof Error ? error.message : String(error),
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

  query = integrationId
    ? query.eq("id", integrationId)
    : query.eq("source_system", SOURCE_SYSTEM).limit(1);

  const { data, error } = (await query.maybeSingle()) as SupabaseResult<IntegrationRow>;
  if (error) throw new Error(`integration_lookup_failed:${error.code ?? error.message}`);
  if (!data) throw new Error("leadflo_integration_not_found");
  return data;
}

function normalizeSettings(settings: Record<string, unknown> | null): LeadfloSettings {
  const feederBaseUrl =
    typeof settings?.feederBaseUrl === "string" ? settings.feederBaseUrl.replace(/\/$/, "") : "";
  const feederApiKeyEnv =
    typeof settings?.feederApiKeyEnv === "string" ? settings.feederApiKeyEnv : "";

  if (!/^https:\/\/[a-z0-9.-]+(\/.*)?$/i.test(feederBaseUrl)) {
    throw new Error("invalid_feeder_base_url");
  }
  if (!/^[A-Z0-9_]+$/.test(feederApiKeyEnv)) throw new Error("invalid_feeder_key_env");

  return { feederBaseUrl, feederApiKeyEnv };
}

/**
 * The feeder caps an unauthenticated read at a single page, so a full mirror has
 * to present the key. Without it we would silently import a fraction of the
 * practice's leads and look complete.
 */
async function fetchFeederLeads(settings: LeadfloSettings, limit: number): Promise<FeederLead[]> {
  const key = process.env[settings.feederApiKeyEnv];
  if (!key) throw new Error(`feeder_key_missing:${settings.feederApiKeyEnv}`);

  const response = await fetch(`${settings.feederBaseUrl}/api/leads?limit=${limit}`, {
    headers: { "X-WF1-Key": key },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`feeder_read_failed:${response.status}`);
  }

  const body = (await response.json()) as { leads?: FeederLead[] };
  if (!Array.isArray(body.leads)) throw new Error("feeder_read_malformed");
  return body.leads;
}

async function loadExistingExternalIds(
  supabase: SupabaseClient,
  practiceId: string,
  externalIds: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  for (let index = 0; index < externalIds.length; index += 200) {
    const chunk = externalIds.slice(index, index + 200);
    const { data, error } = (await supabase
      .from("leads")
      .select("external_id")
      .eq("practice_id", practiceId)
      .eq("source_system", SOURCE_SYSTEM)
      .in("external_id", chunk)) as SupabaseResult<Array<{ external_id: string }>>;
    if (error) throw new Error(`lead_lookup_failed:${error.code ?? error.message}`);
    for (const row of data ?? []) found.add(row.external_id);
  }
  return found;
}

function normalizeLead(row: FeederLead, practiceId: string, now: string) {
  const externalId = row.patientId ?? null;
  if (!externalId) return null;

  const fullName =
    row.fullName || [row.firstName, row.lastName].filter(Boolean).join(" ").trim() || null;

  return {
    practice_id: practiceId,
    name: fullName ?? "Unknown patient",
    // The feeder resolves the number; an unresolvable one is stored empty rather
    // than guessed, because a wrong guess means messaging a stranger. E.164 here
    // matches what the rest of the dashboard stores.
    phone: row.phoneE164 ?? null,
    email: row.email ?? null,
    treatment: treatmentFromLeadflo(row.treatmentType),
    status: row.outboundStatus === "sent" ? "engaged" : "new",
    source: row.source ?? SOURCE_SYSTEM,
    source_system: SOURCE_SYSTEM,
    external_id: externalId,
    external_payload: {
      legacy: {
        patientId: externalId,
        stage: row.stage ?? null,
        treatmentType: row.treatmentType ?? null,
        dueDate: row.dueDate ?? null,
        labels: row.labels ?? [],
        isTestName: row.isTestName ?? false,
        feederStatus: row.status ?? null,
        outboundStatus: row.outboundStatus ?? null,
        outboundSentAt: row.outboundSentAt ?? null,
        firstSeenAt: row.firstSeenAt ?? null,
        lastSeenAt: row.lastSeenAt ?? null,
        rawPhone: row.phone ?? null,
      },
    },
    // box_name/box_stage are what the dashboard UI reads for the pipeline
    // columns. Leadflo's equivalents are the treatment enquired about and the
    // CRM stage.
    box_name: row.treatmentType ?? null,
    box_stage: row.stage ?? null,
    needs_human: false,
    last_synced_at: now,
    // updated_at drives the Leads list ordering, so it tracks when the enquiry
    // arrived rather than when the scraper last touched the row.
    updated_at: row.firstSeenAt ?? row.lastSeenAt ?? now,
  };
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
    skipped: number;
    errorMessage: string | null;
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
            skipped_count: args.skipped,
            error_message: args.errorMessage,
          })
          .eq("id", args.runId)
      : Promise.resolve(),
  ]);
}

function clampLimit(value: unknown) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 5000) : 2000;
}

/**
 * Leadflo's treatment labels mapped onto the slugs the dashboard and the agent
 * config use. Implant has to land on "implants" because that is the treatment
 * Poppy's prompt and pricing are keyed on.
 */
function treatmentFromLeadflo(treatmentType: string | null | undefined) {
  const value = (treatmentType ?? "").toLowerCase();
  if (value.includes("implant")) return "implants";
  if (value.includes("ortho") || value.includes("align")) return "invisalign";
  if (value.includes("cosmetic")) return "cosmetic";
  if (value.includes("facial")) return "facial";
  if (value.includes("whiten")) return "whitening";
  if (value.includes("hygiene")) return "hygiene";
  if (value.includes("emergency")) return "emergency";
  return "general";
}

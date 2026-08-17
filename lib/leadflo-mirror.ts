import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";
import {
  syncLeadfloConversations,
  type ConversationStat,
  type LeadfloConversationResult,
  type LeadOpener,
} from "@/lib/leadflo-conversations";

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
  /** When the patient enquired, per their Leadflo timeline. Null until resolved. */
  enquiredAt?: string | null;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  outboundStatus?: string | null;
  outboundSentAt?: string | null;
  /** What WF-1 actually said. The feeder keeps the text of the latest send. */
  outboundMessage?: string | null;
  /** Set once WF-2 has written a conversation turn back to Leadflo. */
  noteWrittenAt?: string | null;
  aiNote?: string | null;
};

type LeadfloSettings = {
  feederBaseUrl: string;
  feederApiKeyEnv: string;
  /**
   * Where a paid deposit turns into a Dentally appointment. That state lives in
   * the workflow's own table rather than in Leadflo, so without it the mirror
   * cannot tell a booked patient from one who is still talking.
   */
  bookingSupabaseUrlEnv: string;
  bookingSupabaseServiceRoleKeyEnv: string;
  bookingTable: string;
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
  /** Repeated patient ids from the feeder, dropped so the batch can still land. */
  duplicateExternalIds: string[];
  /** Null when the conversation pass could not run; the lead mirror still did. */
  conversations: LeadfloConversationResult | null;
  conversationSkipped: string | null;
  /** Set when booked leads could not be identified this run. */
  bookingSkipped: string | null;
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
  /** Repeated patient ids from the feeder. A duplicate used to fail the whole batch. */
  duplicateExternalIds: string[];
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

/** A lead row as this module builds it for the dashboard. */
type LeadRecord = NonNullable<ReturnType<typeof normalizeLead>>;

/**
 * The dashboard reads a lead's history out of external_payload, in a shape
 * Boxly established: `legacy` for the lead's own history, `raw` for the source
 * system's record, `summary` for the line shown beside them.
 */
type LeadPayload = {
  legacy: Record<string, unknown>;
  raw?: Record<string, unknown>;
  summary?: string | null;
};

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
  const mapped = rows
    .map((row) => normalizeLead(row, practiceId, now))
    .filter((row): row is NonNullable<ReturnType<typeof normalizeLead>> => {
      if (row) return true;
      skipped += 1;
      return false;
    });

  // Previewing the deduped set, so the counts match what a run would actually do.
  const { unique: records, duplicates } = dedupeByExternalId(mapped);

  const existing = await loadExistingLeads(
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
    duplicateExternalIds: duplicates,
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
  let duplicateExternalIds: string[] = [];
  let conversations: LeadfloConversationResult | null = null;
  let conversationSkipped: string | null = null;
  let bookingSkipped: string | null = null;

  try {
    const rows = await fetchFeederLeads(settings, clampLimit(options.limit));
    sourceCount = rows.length;

    const now = new Date().toISOString();
    const mapped = rows
      .map((row) => normalizeLead(row, practiceId, now))
      .filter((row): row is NonNullable<ReturnType<typeof normalizeLead>> => {
        if (row) return true;
        skipped += 1;
        return false;
      });

    const { unique: records, duplicates } = dedupeByExternalId(mapped);
    duplicateExternalIds = duplicates;

    const existing = await loadExistingLeads(
      ours,
      practiceId,
      records.map((record) => record.external_id),
    );

    // Knowing who is booked is an enrichment, not the job. If the booking table
    // cannot be read the leads still mirror; they just stay at "engaged", and
    // the reason is recorded on the run rather than thrown away.
    let booked = new Set<string>();
    try {
      booked = await loadBookedNumbers(settings);
    } catch (bookingError) {
      bookingSkipped =
        bookingError instanceof Error ? bookingError.message : String(bookingError);
    }

    for (const record of records) {
      const digits = digitsOf(record.phone);
      const derived = digits && booked.has(digits) ? "booked" : record.status;
      record.status = resolveStatus(derived, existing.get(record.external_id)?.status);
    }

    const leadIds = new Map(
      [...existing].map(([externalId, lead]) => [externalId, lead.id] as const),
    );

    for (let index = 0; index < records.length; index += 500) {
      const chunk = records.slice(index, index + 500);
      const { data, error } = (await ours
        .from("leads")
        .upsert(chunk, { onConflict: "practice_id,source_system,external_id" })
        .select("id, external_id")) as SupabaseResult<
        Array<{ id: string; external_id: string }>
      >;
      if (error) throw new Error(`lead_upsert_failed:${error.code ?? error.message}`);
      for (const row of data ?? []) leadIds.set(row.external_id, row.id);
      leadsUpserted += chunk.length;
    }

    // Conversations are a separate, chattier job than the lead rows, and one
    // unreadable timeline must not cost us the mirror. The enquiry-date backfill
    // taught us that the hard way: an optional enrichment step took the whole
    // poll down with it.
    try {
      const talking = rows
        .filter((row) => row.patientId && hasConversation(row))
        .filter((row) => leadIds.has(row.patientId as string))
        .map((row) => ({
          externalId: row.patientId as string,
          leadId: leadIds.get(row.patientId as string)!,
          opener: openerOf(row),
        }));

      conversations = await syncLeadfloConversations({
        supabase: ours,
        practiceId,
        feederBaseUrl: settings.feederBaseUrl,
        feederApiKey: process.env[settings.feederApiKeyEnv] ?? "",
        leads: talking,
      });

      await describeConversations(ours, records, conversations.stats);
    } catch (conversationError) {
      conversationSkipped =
        conversationError instanceof Error
          ? conversationError.message
          : String(conversationError);
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
      duplicateExternalIds,
      conversations,
      conversationSkipped,
      bookingSkipped,
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
      duplicateExternalIds,
      conversations,
      conversationSkipped,
      bookingSkipped,
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
  const text = (key: string) => (typeof settings?.[key] === "string" ? (settings[key] as string) : "");

  const feederBaseUrl = text("feederBaseUrl").replace(/\/$/, "");
  const feederApiKeyEnv = text("feederApiKeyEnv");

  if (!/^https:\/\/[a-z0-9.-]+(\/.*)?$/i.test(feederBaseUrl)) {
    throw new Error("invalid_feeder_base_url");
  }
  if (!/^[A-Z0-9_]+$/.test(feederApiKeyEnv)) throw new Error("invalid_feeder_key_env");

  // The booking source is optional: a practice without one still mirrors, it
  // just never reports a lead as booked.
  const bookingSupabaseUrlEnv = text("bookingSupabaseUrlEnv");
  const bookingSupabaseServiceRoleKeyEnv = text("bookingSupabaseServiceRoleKeyEnv");
  const bookingTable = text("bookingTable");
  const bookingConfigured =
    bookingSupabaseUrlEnv || bookingSupabaseServiceRoleKeyEnv || bookingTable;

  if (bookingConfigured) {
    if (!/^[A-Z0-9_]+$/.test(bookingSupabaseUrlEnv)) throw new Error("invalid_booking_url_env");
    if (!/^[A-Z0-9_]+$/.test(bookingSupabaseServiceRoleKeyEnv)) {
      throw new Error("invalid_booking_key_env");
    }
    if (!/^[a-z0-9_]+$/.test(bookingTable)) throw new Error("invalid_booking_table");
  }

  return {
    feederBaseUrl,
    feederApiKeyEnv,
    bookingSupabaseUrlEnv,
    bookingSupabaseServiceRoleKeyEnv,
    bookingTable,
  };
}

/**
 * Where a practice's feeder lives and the key that reads it.
 *
 * The mirror resolves this per run from the practice's integration row. The
 * patient history panel needs the same answer for a single lead, and resolving
 * it the same way keeps one practice's data unreachable with another's key.
 */
export async function loadLeadfloFeederAccess(
  practiceId: string,
): Promise<{ baseUrl: string; apiKey: string }> {
  const ours = supabaseAdmin();
  if (!ours) throw new Error("storage_unavailable");

  const integration = await loadIntegration(ours, practiceId, null);
  const settings = normalizeSettings(integration.settings);
  const apiKey = process.env[settings.feederApiKeyEnv];
  if (!apiKey) throw new Error(`feeder_key_missing:${settings.feederApiKeyEnv}`);

  return { baseUrl: settings.feederBaseUrl, apiKey };
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

/**
 * Collapse repeated external_ids, keeping the last occurrence.
 *
 * Postgres rejects an entire upsert batch with a cardinality violation if one
 * conflict key appears twice in it, so a single duplicated patient id stops the
 * whole practice syncing — which is how the dashboard sat stale for over an
 * hour. The feeder is the source of truth and later rows are the fresher read,
 * so the duplicate is dropped rather than the batch.
 */
function dedupeByExternalId<T extends { external_id: string }>(
  records: T[],
): { unique: T[]; duplicates: string[] } {
  const byId = new Map<string, T>();
  const duplicates: string[] = [];

  for (const record of records) {
    if (byId.has(record.external_id)) duplicates.push(record.external_id);
    byId.set(record.external_id, record);
  }

  return { unique: [...byId.values()], duplicates };
}

/**
 * Write each thread's shape back onto its lead: how many turns it ran to,
 * whether the patient ever answered, and what was last said.
 *
 * This is a second pass because the counts only exist once the messages have
 * been read, and it touches only the handful of leads that have a conversation
 * rather than re-writing the practice.
 */
async function describeConversations(
  supabase: SupabaseClient,
  records: LeadRecord[],
  stats: ConversationStat[],
) {
  if (!stats.length) return;

  const byExternalId = new Map(records.map((record) => [record.external_id, record]));
  const described: LeadRecord[] = [];

  for (const stat of stats) {
    const record = byExternalId.get(stat.externalId);
    if (!record || !stat.messages) continue;

    described.push({
      ...record,
      external_payload: {
        ...record.external_payload,
        legacy: { ...record.external_payload.legacy, conversationCount: stat.messages },
        // A reply is the strongest signal a lead is live, and the dashboard
        // reads it from raw rather than legacy.
        raw: { client_replied: stat.inbound > 0 },
        // Shown in place of the stage on the activity row, so the list reads as
        // a conversation rather than a column name.
        summary: stat.lastBody,
      },
    });
  }

  if (!described.length) return;

  const { error } = await supabase
    .from("leads")
    .upsert(described, { onConflict: "practice_id,source_system,external_id" });
  if (error) throw new Error(`conversation_describe_failed:${error.code ?? error.message}`);
}

/** Leads we already hold, by Leadflo patient id, with what we currently say about them. */
async function loadExistingLeads(
  supabase: SupabaseClient,
  practiceId: string,
  externalIds: string[],
): Promise<Map<string, { id: string; status: string | null }>> {
  const found = new Map<string, { id: string; status: string | null }>();
  for (let index = 0; index < externalIds.length; index += 200) {
    const chunk = externalIds.slice(index, index + 200);
    const { data, error } = (await supabase
      .from("leads")
      .select("id, external_id, status")
      .eq("practice_id", practiceId)
      .eq("source_system", SOURCE_SYSTEM)
      .in("external_id", chunk)) as SupabaseResult<
      Array<{ id: string; external_id: string; status: string | null }>
    >;
    if (error) throw new Error(`lead_lookup_failed:${error.code ?? error.message}`);
    for (const row of data ?? []) found.set(row.external_id, { id: row.id, status: row.status });
  }
  return found;
}

function normalizeLead(row: FeederLead, practiceId: string, now: string) {
  const externalId = row.patientId ?? null;
  if (!externalId) return null;

  const fullName =
    row.fullName || [row.firstName, row.lastName].filter(Boolean).join(" ").trim() || null;

  const external_payload: LeadPayload = {
    // The dashboard reads a lead's history out of external_payload.legacy, a
    // shape Boxly established. Leadflo's fields are named differently, so the
    // equivalents are written under the names the dashboard already looks for;
    // otherwise every count, chart and activity row reads zero for a patient
    // Poppy has spoken to.
    legacy: {
      aiActioned: hasConversation(row),
      actionedAt: contactedAt(row),
      aiActionedAt: contactedAt(row),
      becameLeadAt: row.enquiredAt ?? row.firstSeenAt ?? null,
      lastUpdatedAt: row.lastSeenAt ?? null,
      scrapedAt: row.lastSeenAt ?? null,

      patientId: externalId,
      stage: row.stage ?? null,
      treatmentType: row.treatmentType ?? null,
      dueDate: row.dueDate ?? null,
      labels: row.labels ?? [],
      isTestName: row.isTestName ?? false,
      feederStatus: row.status ?? null,
      outboundStatus: row.outboundStatus ?? null,
      outboundSentAt: row.outboundSentAt ?? null,
      enquiredAt: row.enquiredAt ?? null,
      firstSeenAt: row.firstSeenAt ?? null,
      lastSeenAt: row.lastSeenAt ?? null,
      rawPhone: row.phone ?? null,
    },
  };

  return {
    practice_id: practiceId,
    name: fullName ?? "Unknown patient",
    // The feeder resolves the number; an unresolvable one is stored empty rather
    // than guessed, because a wrong guess means messaging a stranger. E.164 here
    // matches what the rest of the dashboard stores.
    phone: row.phoneE164 ?? null,
    email: row.email ?? null,
    treatment: treatmentFromLeadflo(row.treatmentType),
    status: hasConversation(row) ? "engaged" : "new",
    source: row.source ?? SOURCE_SYSTEM,
    source_system: SOURCE_SYSTEM,
    external_id: externalId,
    external_payload,
    // box_name/box_stage are what the dashboard UI reads for the pipeline
    // columns. Leadflo's equivalents are the treatment enquired about and the
    // CRM stage.
    box_name: row.treatmentType ?? null,
    box_stage: row.stage ?? null,
    needs_human: false,
    last_synced_at: now,
    // updated_at drives the Leads list ordering, so it tracks when the enquiry
    // arrived rather than when the scraper last touched the row. enquiredAt is the
    // real date; firstSeenAt only says when the feeder discovered the patient,
    // which for the initial backfill was one afternoon for years of enquiries.
    updated_at: row.enquiredAt ?? row.firstSeenAt ?? row.lastSeenAt ?? now,
  };
}

/**
 * Whether Poppy and this patient have spoken. Any of the three is enough: the
 * outbound flag can be cleared by a demo reset, but a written note is proof the
 * conversation happened.
 */
function hasConversation(row: FeederLead) {
  return row.outboundStatus === "sent" || Boolean(row.noteWrittenAt) || Boolean(row.aiNote);
}

/**
 * The message WF-1 opened with, where the feeder recorded one.
 *
 * Both the text and the send time have to be there. An opener with no time would
 * land at the moment of import, which puts Poppy's first words after the
 * patient's reply and reads worse than leaving it out.
 */
function openerOf(row: FeederLead): LeadOpener | null {
  if (row.outboundStatus !== "sent") return null;
  if (!row.outboundMessage || !row.outboundSentAt) return null;
  return { body: row.outboundMessage, sentAt: row.outboundSentAt };
}

/** When Poppy first reached the patient, as well as the feeder can say. */
function contactedAt(row: FeederLead) {
  if (!hasConversation(row)) return null;
  return row.outboundSentAt ?? row.noteWrittenAt ?? null;
}

const STATUS_RANK: Record<string, number> = { new: 0, engaged: 1, booked: 2 };

/**
 * Merge what this run worked out with what is already stored, never going
 * backwards. Clearing a lead's outbound flag to re-run a demo does not unmake
 * the conversation, and demoting them to "new" is what dropped them out of the
 * Activity tab. A status we do not recognise was set by hand, so it is left be.
 */
function resolveStatus(derived: string, stored: string | null | undefined) {
  if (!stored) return derived;
  const storedRank = STATUS_RANK[stored];
  if (storedRank === undefined) return stored;
  return storedRank > (STATUS_RANK[derived] ?? 0) ? stored : derived;
}

/**
 * Phone numbers with a Dentally appointment against them, as digits.
 *
 * A deposit that was paid but failed to book is deliberately not counted: the
 * appointment id is the only evidence the patient actually has a slot.
 */
async function loadBookedNumbers(settings: LeadfloSettings): Promise<Set<string>> {
  if (!settings.bookingTable) return new Set();

  const url = process.env[settings.bookingSupabaseUrlEnv];
  const key = process.env[settings.bookingSupabaseServiceRoleKeyEnv];
  if (!url || !key) throw new Error(`booking_source_env_missing:${settings.bookingSupabaseUrlEnv}`);

  const bookings = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = (await bookings
    .from(settings.bookingTable)
    .select("number, dentally_appointment_id")
    .not("dentally_appointment_id", "is", null)) as SupabaseResult<
    Array<{ number: string | null }>
  >;
  if (error) throw new Error(`booking_lookup_failed:${error.code ?? error.message}`);

  const numbers = new Set<string>();
  for (const row of data ?? []) {
    const digits = digitsOf(row.number);
    if (digits) numbers.add(digits);
  }
  return numbers;
}

/** Numbers are stored E.164 here and bare in the booking table, so compare digits. */
function digitsOf(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
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
    duplicateExternalIds?: string[];
    conversations?: LeadfloConversationResult | null;
    conversationSkipped?: string | null;
    bookingSkipped?: string | null;
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
            // Recorded so a repeat is diagnosable from the sync history alone,
            // rather than needing the feeder's full lead list to reproduce.
            metadata: {
              integrationId: args.integrationId,
              duplicateExternalIds: args.duplicateExternalIds ?? [],
              // Counts only. The per-lead stats carry what was last said, and a
              // sync log is no place to keep a copy of a patient's conversation.
              conversations: args.conversations
                ? { ...args.conversations, stats: args.conversations.stats.length }
                : null,
              conversationSkipped: args.conversationSkipped ?? null,
              bookingSkipped: args.bookingSkipped ?? null,
            },
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

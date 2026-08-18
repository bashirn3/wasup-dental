import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DENTAL_AESTHETICA_CONSULT_VALUE,
  DENTAL_AESTHETICA_PRACTICE_NAME,
  buildDentalAestheticaRows,
  getDentalAestheticaNotes,
} from "./funnel-dental-aesthetica";
import { supabaseAdmin } from "./supabase";

export type PracticeKey = "regent" | "nuyu" | "dental_aesthetica";

export type FunnelStatus =
  | "all"
  | "reached"
  | "replied"
  | "booked"
  | "opportunity"
  | "paid";

export type AttributionConfidence = "high" | "medium" | "low" | "none";

export type FunnelLeadRow = {
  id: string;
  practice: PracticeKey;
  practiceLabel: string;
  boxlyLeadId: string;
  patientName: string;
  phone: string | null;
  email: string | null;
  leadSource: string;
  boxName: string | null;
  boxStage: string | null;
  leadSummary: string | null;
  aiActioned: boolean;
  clientReplied: boolean;
  conversationCount: number;
  becameLeadAt: string | null;
  actionedAt: string | null;
  aiActionedAt: string | null;
  lastUpdatedAt: string | null;
  actionedNote: string | null;
  consultBooked: boolean;
  consultBookingValue: number;
  bookedUsingSystem: boolean;
  attributionConfidence: AttributionConfidence;
  attributionReason: string;
  attributedPaymentRevenue: number;
  consultDepositRevenue: number;
  monthlyPlanRevenue: number;
  otherPaidRevenue: number;
  hardPaidRevenue: number;
  estimatedTreatmentOpportunity: number;
  treatmentEvidence: boolean;
  treatmentEvidenceReason: string | null;
  dentallyConsultAt: string | null;
  dentallyTreatmentAt: string | null;
  dentallyPaidAt: string | null;
  commercialSequence: string;
  dentallyPatientId: string | null;
  dentallyStatus: "pending" | "not_enriched";
  /**
   * When Dentally was last asked about this patient. Absent on rows from before
   * the funnel started building up in nightly passes.
   *
   * A full pass costs around two seconds a patient, which is far longer than a
   * serverless function may run, so each run carries forward what earlier runs
   * learned and spends its time on patients that are new or stale. This is how it
   * knows which those are.
   */
  dentallyCheckedAt?: string | null;
};

export type FunnelPracticeSummary = {
  key: PracticeKey;
  label: string;
  v1ActivityUrl: string;
  /**
   * What this practice charges for a consultation. Zero where the consultation
   * is free, which makes "consults booked" a count rather than a sum.
   */
  consultValue: number;
  /** Our own test leads, excluded from every figure here. */
  testRowsExcluded: number;
  leadsReached: number;
  patientsReplied: number;
  consultsBooked: number;
  consultBookingValue: number;
  attributedPaymentRevenue: number;
  consultDepositRevenue: number;
  monthlyPlanRevenue: number;
  otherPaidRevenue: number;
  hardPaidTreatmentRevenue: number;
  estimatedTreatmentOpportunity: number;
  treatmentOpportunityCount: number;
  paidTreatmentCount: number;
  totalMessagesExchanged: number;
  metaApiCostSavings: number;
  sourceBreakdown: { source: string; leads: number; replied: number; booked: number }[];
  funnel: { key: string; label: string; value: number; helper: string }[];
  rows: FunnelLeadRow[];
};

export type FunnelResult = {
  generatedAt: string;
  cache: {
    status: "fresh" | "stale";
    ageMs: number;
    ttlMs: number;
  };
  dentally: {
    status: "not_enriched" | "partial" | "enriched" | "error";
    message: string;
    enrichedRows?: number;
    attemptedRows?: number;
    /** Patients whose evidence came from an earlier pass rather than a fresh call. */
    carriedRows?: number;
    /** Patients still queued because this run ran out of time. */
    pendingRows?: number;
  };
  practices: FunnelPracticeSummary[];
  /**
   * Practices that could not be read this run. Reported rather than dropped in
   * silence, so a missing practice cannot be mistaken for a practice with no
   * activity.
   */
  warnings: string[];
};

export type FunnelNote = {
  id: string;
  title: string;
  description: string;
  createdAt: string | null;
  createdBy: string | null;
};

type V1Lead = {
  id?: string | null;
  boxly_lead_id?: string | null;
  full_name?: string | null;
  phone_number?: string | null;
  phone_e164?: string | null;
  email?: string | null;
  box_name?: string | null;
  box_stage?: string | null;
  lead_source?: string | null;
  lead_summary?: string | null;
  actioned?: boolean | null;
  actioned_at?: string | null;
  actioned_note?: string | null;
  ai_actioned?: boolean | null;
  ai_actioned_at?: string | null;
  became_lead_at?: string | null;
  last_updated_at?: string | null;
  conversation_count?: number | null;
  raw_data?: Record<string, unknown> | null;
};

type V1ActivityPayload = {
  results?: V1Lead[];
  total?: number;
  page?: number;
  limit?: number;
  summary?: {
    total_actioned?: number;
    ai_responded?: number;
    responded?: number;
  };
};

type DentallyEvidence = {
  patientId: string | null;
  consultBooked: boolean;
  consultCompleted: boolean;
  treatmentEvidence: boolean;
  consultAt: string | null;
  treatmentAt: string | null;
  paidAt: string | null;
  attributedPaymentRevenue: number;
  consultDepositRevenue: number;
  monthlyPlanRevenue: number;
  otherPaidRevenue: number;
  paidRevenue: number;
  estimatedOpportunity: number;
  reason: string;
  treatmentReason: string | null;
};

/**
 * Where a practice's engagement is read from.
 *
 * Regent and NuYu each run a Boxly V1 app that reports what their AI did. Dental
 * Aesthetica does not: its leads, its conversation and its bookings are held by
 * us, so it is assembled from our own tables instead.
 */
type PracticeSource =
  | { kind: "boxly_v1"; v1BaseUrl: string }
  | { kind: "wasup"; activityUrl: string };

type PracticeConfig = {
  label: string;
  /** The practice's name in our own practices table, used to scope access. */
  practiceName: string;
  source: PracticeSource;
  /**
   * What one booked consultation is worth. Regent and NuYu charge a consultation
   * fee, so their booked consults carry it. Dental Aesthetica charges no fee —
   * only a refundable deposit — and carrying another practice's fee across would
   * report money it never asked a patient for.
   */
  consultValue: number;
  /** Env vars that may hold this practice's Dentally API token, in order. */
  dentallyTokenEnvs: string[];
};

const CONSULT_FEE_GBP = 65;

const PRACTICES: Record<PracticeKey, PracticeConfig> = {
  regent: {
    label: "Regent Dental",
    practiceName: "Regent Dental",
    source: { kind: "boxly_v1", v1BaseUrl: "https://boxly-agent.vercel.app" },
    consultValue: CONSULT_FEE_GBP,
    dentallyTokenEnvs: ["REGENT_DENTALLY_API_TOKEN", "DENTALLY_REGENT_API_TOKEN", "DENTALLY_API_TOKEN_REGENT"],
  },
  nuyu: {
    label: "NuYu Dental",
    practiceName: "Nuyu Dental",
    source: { kind: "boxly_v1", v1BaseUrl: "https://nuyu-boxly-agent-lyart.vercel.app" },
    consultValue: CONSULT_FEE_GBP,
    dentallyTokenEnvs: ["NUYU_DENTALLY_API_TOKEN", "DENTALLY_NUYU_API_TOKEN", "DENTALLY_API_TOKEN_NUYU"],
  },
  dental_aesthetica: {
    label: "Dental Aesthetica",
    practiceName: DENTAL_AESTHETICA_PRACTICE_NAME,
    source: { kind: "wasup", activityUrl: "/dashboard" },
    consultValue: DENTAL_AESTHETICA_CONSULT_VALUE,
    dentallyTokenEnvs: [
      "DENTAL_AESTHETICA_DENTALLY_API_TOKEN",
      "DA_DENTALLY_API_TOKEN",
      "DENTALLY_API_TOKEN_DENTAL_AESTHETICA",
    ],
  },
};

const PAGE_SIZE = 200;
const CACHE_TTL_MS = 2 * 60 * 1000;
const META_MESSAGE_COST = 0.07;
const SNAPSHOT_PATH = join(process.cwd(), ".cache", "admin-attribution-funnel-snapshot.json");
const SNAPSHOT_KEY = "admin-attribution-funnel";

let cached: { generatedAtMs: number; result: Omit<FunnelResult, "cache"> } | null = null;
let inFlight: Promise<Omit<FunnelResult, "cache">> | null = null;
const dentallyCache = new Map<string, DentallyEvidence>();
const boxlyBookingCache = new Map<string, { booked: boolean; reason: string }>();

/** What a scheduled run may spend on Dentally before saving what it has. */
const DEFAULT_DENTALLY_BUDGET_MS = 200_000;

export async function getAdminAttributionFunnel(
  options: {
    refresh?: boolean;
    enrichDentally?: boolean;
    dentallyLimit?: number;
    /** Time to spend asking Dentally. The rest of the queue waits for next run. */
    budgetMs?: number;
  } = {},
): Promise<FunnelResult> {
  const refresh = Boolean(options.refresh);
  const enrichDentally = Boolean(options.enrichDentally);
  const now = Date.now();
  if (!refresh && !enrichDentally && cached) {
    const ageMs = now - cached.generatedAtMs;
    if (ageMs <= CACHE_TTL_MS) {
      return withCache(cached.result, "fresh", ageMs);
    }
  }

  if (!refresh && !enrichDentally) {
    const persisted = await loadPersistedSnapshot();
    if (persisted) {
      cached = { generatedAtMs: persisted.generatedAtMs, result: persisted.result };
      return withCache(persisted.result, persisted.status, Date.now() - persisted.generatedAtMs);
    }
    return withCache(noSnapshotResult(), "stale", 0);
  }

  if (!refresh && inFlight) {
    const result = await inFlight;
    return withCache(result, "fresh", Date.now() - new Date(result.generatedAt).getTime());
  }

  inFlight = buildFunnel(
    enrichDentally,
    options.dentallyLimit ?? 180,
    options.budgetMs ?? DEFAULT_DENTALLY_BUDGET_MS,
  );
  try {
    const result = await inFlight;
    cached = { generatedAtMs: Date.now(), result };
    if (result.dentally.status !== "not_enriched") await persistSnapshot(result);
    return withCache(result, "fresh", 0);
  } catch (error) {
    if (cached) {
      return withCache(
        {
          ...cached.result,
          dentally: {
            ...cached.result.dentally,
            message: `Showing last successful V1 snapshot. Latest refresh failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        },
        "stale",
        Date.now() - cached.generatedAtMs,
      );
    }
    throw error;
  } finally {
    inFlight = null;
  }
}

export async function getFunnelLeadNotes(practice: PracticeKey, leadId: string): Promise<FunnelNote[]> {
  const cfg = PRACTICES[practice];
  // Dental Aesthetica's AI writes no Boxly note; the conversation is the record.
  if (cfg.source.kind === "wasup") return getDentalAestheticaNotes(leadId);

  const safeLeadId = encodeURIComponent(leadId);
  const url = `${cfg.source.v1BaseUrl}/api/v1/agent/activity/${safeLeadId}/notes`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`v1_notes_failed:${res.status}`);
  const payload = (await res.json()) as { notes?: unknown[] };
  return (payload.notes ?? []).map((note, index) => {
    const record = asRecord(note);
    return {
      id: stringValue(record.id) || `${leadId}-${index}`,
      title: stringValue(record.title),
      description: stringValue(record.description),
      createdAt: stringValue(record.created_at) || null,
      createdBy: stringValue(record.created_by) || null,
    };
  });
}

/**
 * The funnel as one practice's contact should see it.
 *
 * Everything is built in one pass because the practices share a snapshot, so the
 * cut has to happen on the way out. Warnings about other practices go with them:
 * they name a system the reader has no part in and cannot act on.
 */
export function scopeFunnelToPractices(result: FunnelResult, practiceNames: string[]): FunnelResult {
  const allowed = funnelKeysForPracticeNames(practiceNames);
  const labels = new Set([...allowed].map((key) => PRACTICES[key].label));
  return {
    ...result,
    practices: result.practices.filter((practice) => allowed.has(practice.key)),
    warnings: result.warnings.filter((warning) => [...labels].some((label) => warning.startsWith(label))),
  };
}

export function funnelKeysForPracticeNames(practiceNames: string[]): Set<PracticeKey> {
  const wanted = new Set(practiceNames.map((name) => name.trim().toLowerCase()));
  return new Set(
    (Object.keys(PRACTICES) as PracticeKey[]).filter((key) =>
      wanted.has(PRACTICES[key].practiceName.toLowerCase()),
    ),
  );
}

export function funnelToCsv(result: FunnelResult): string {
  const headers = [
    "practice",
    "patient",
    "phone",
    "email",
    "lead_source",
    "box",
    "stage",
    "ai_actioned",
    "client_replied",
    "messages",
    "consult_booked",
    "booked_using_system",
    "consult_booking_value",
    "attributed_payment_revenue",
    "consult_deposit_revenue",
    "monthly_plan_revenue",
    "other_paid_revenue",
    "hard_paid_revenue",
    "known_treatment_value",
    "treatment_evidence",
    "treatment_evidence_reason",
    "dentally_consult_at",
    "dentally_treatment_at",
    "dentally_paid_at",
    "commercial_sequence",
    "dentally_patient_id",
    "attribution_confidence",
    "attribution_reason",
    "ai_actioned_at",
    "actioned_note",
  ];
  const rows = result.practices.flatMap((practice) =>
    practice.rows.map((row) => [
      row.practiceLabel,
      row.patientName,
      row.phone ?? "",
      row.email ?? "",
      row.leadSource,
      row.boxName ?? "",
      row.boxStage ?? "",
      row.aiActioned ? "yes" : "no",
      row.clientReplied ? "yes" : "no",
      String(row.conversationCount),
      row.consultBooked ? "yes" : "no",
      row.bookedUsingSystem ? "yes" : "no",
      row.consultBookingValue.toFixed(2),
      row.attributedPaymentRevenue.toFixed(2),
      row.consultDepositRevenue.toFixed(2),
      row.monthlyPlanRevenue.toFixed(2),
      row.otherPaidRevenue.toFixed(2),
      row.hardPaidRevenue.toFixed(2),
      row.estimatedTreatmentOpportunity.toFixed(2),
      row.treatmentEvidence ? "yes" : "no",
      row.treatmentEvidenceReason ?? "",
      row.dentallyConsultAt ?? "",
      row.dentallyTreatmentAt ?? "",
      row.dentallyPaidAt ?? "",
      row.commercialSequence,
      row.dentallyPatientId ?? "",
      row.attributionConfidence,
      row.attributionReason,
      row.aiActionedAt ?? "",
      row.actionedNote ?? "",
    ]),
  );
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

async function buildFunnel(
  enrichDentally: boolean,
  dentallyLimit: number,
  budgetMs: number,
): Promise<Omit<FunnelResult, "cache">> {
  // Settled rather than all: one practice's source being down should cost that
  // practice's column, not the whole page.
  const settled = await Promise.allSettled(
    (Object.keys(PRACTICES) as PracticeKey[]).map((key) => loadPractice(key)),
  );

  let practices: FunnelPracticeSummary[] = [];
  const warnings: string[] = [];
  settled.forEach((outcome, index) => {
    const key = (Object.keys(PRACTICES) as PracticeKey[])[index];
    if (outcome.status === "fulfilled") {
      practices.push(outcome.value);
      return;
    }
    const reason = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
    warnings.push(`${PRACTICES[key].label} could not be read: ${reason}`);
  });

  if (!practices.length) {
    throw new Error(warnings[0] ?? "no_practice_sources_available");
  }

  let dentally: Omit<FunnelResult["dentally"], "status"> & { status: FunnelResult["dentally"]["status"] } = {
    status: "not_enriched",
    message:
      "V1/Boxly engagement is loaded. Paid treatment revenue and treatment opportunity are pending until the safe cached Dentally snapshot is run.",
  };

  if (enrichDentally) {
    const enrichment = await enrichWithDentally(practices, {
      limitPerPractice: dentallyLimit,
      budgetMs,
      carried: await carriedRowsFromSnapshot(),
    });
    practices = enrichment.practices;

    const parts = [
      `Dentally matched ${enrichment.enrichedRows} of ${enrichment.attemptedRows} patients asked about`,
    ];
    if (enrichment.carriedRows) parts.push(`${enrichment.carriedRows} carried from earlier passes`);
    if (enrichment.pendingRows) parts.push(`${enrichment.pendingRows} queued for the next run`);
    if (enrichment.errors.length) parts.push(enrichment.errors[0]);

    dentally = {
      status: enrichment.errors.length || enrichment.pendingRows ? "partial" : "enriched",
      message: `${parts.join(". ")}.`,
      enrichedRows: enrichment.enrichedRows,
      attemptedRows: enrichment.attemptedRows,
      carriedRows: enrichment.carriedRows,
      pendingRows: enrichment.pendingRows,
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    dentally,
    practices,
    warnings,
  };
}

/**
 * The last saved snapshot's rows, keyed by row id.
 *
 * Nothing here is trusted as current; it is the starting point a run builds on so
 * that an unfinished pass costs progress rather than everything.
 */
async function carriedRowsFromSnapshot(): Promise<Map<string, FunnelLeadRow>> {
  const carried = new Map<string, FunnelLeadRow>();
  try {
    const persisted = await loadPersistedSnapshot();
    for (const practice of persisted?.result.practices ?? []) {
      for (const row of practice.rows) carried.set(row.id, row);
    }
  } catch {
    // A missing or unreadable snapshot only means this run starts from scratch.
  }
  return carried;
}

async function loadPractice(key: PracticeKey): Promise<FunnelPracticeSummary> {
  const cfg = PRACTICES[key];
  if (cfg.source.kind === "wasup") {
    const built = await buildDentalAestheticaRows();
    return summarizeRows(key, built.rows, built.testRowsExcluded);
  }
  const leads = await fetchAllV1Leads(key);
  return summarizePractice(key, leads);
}

async function fetchAllV1Leads(practice: PracticeKey): Promise<V1Lead[]> {
  const cfg = PRACTICES[practice];
  if (cfg.source.kind !== "boxly_v1") return [];
  const all: V1Lead[] = [];
  for (let page = 1; ; page += 1) {
    const url = new URL(`${cfg.source.v1BaseUrl}/api/v1/agent/activity-fast`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(PAGE_SIZE));
    const res = await fetch(url.toString(), { next: { revalidate: 60 } });
    if (!res.ok) throw new Error(`${practice}_v1_activity_failed:${res.status}`);
    const payload = (await res.json()) as V1ActivityPayload;
    const results = payload.results ?? [];
    all.push(...results);
    const total = payload.total ?? all.length;
    if (results.length === 0 || all.length >= total) break;
  }
  return all;
}

function summarizePractice(practice: PracticeKey, leads: V1Lead[]): FunnelPracticeSummary {
  const cfg = PRACTICES[practice];
  const rows = leads.map((lead) => mapLead(practice, cfg.label, lead));
  return summarizeRows(practice, rows);
}

function summarizeRows(
  practice: PracticeKey,
  rows: FunnelLeadRow[],
  testRowsExcluded = 0,
): FunnelPracticeSummary {
  const cfg = PRACTICES[practice];
  const source = cfg.source;
  const leadsReached = rows.filter((row) => row.aiActioned).length;
  const patientsReplied = rows.filter((row) => row.clientReplied).length;
  const consultsBooked = rows.filter((row) => row.consultBooked).length;
  const totalMessagesExchanged = rows.reduce((sum, row) => sum + row.conversationCount, 0);
  const consultBookingValue = consultsBooked * cfg.consultValue;
  const commercialRows = uniqueCommercialRows(rows);
  const attributedPaymentRevenue = commercialRows.reduce((sum, row) => sum + row.attributedPaymentRevenue, 0);
  const consultDepositRevenue = commercialRows.reduce((sum, row) => sum + row.consultDepositRevenue, 0);
  const monthlyPlanRevenue = commercialRows.reduce((sum, row) => sum + row.monthlyPlanRevenue, 0);
  const otherPaidRevenue = commercialRows.reduce((sum, row) => sum + row.otherPaidRevenue, 0);
  const hardPaidTreatmentRevenue = commercialRows.reduce((sum, row) => sum + row.hardPaidRevenue, 0);
  const estimatedTreatmentOpportunity = commercialRows.reduce((sum, row) => sum + row.estimatedTreatmentOpportunity, 0);
  const paidTreatmentCount = commercialRows.filter((row) => row.hardPaidRevenue > 0).length;
  const treatmentOpportunityCount = commercialRows.filter((row) => row.treatmentEvidence && row.hardPaidRevenue <= 0).length;

  return {
    key: practice,
    label: cfg.label,
    v1ActivityUrl: source.kind === "wasup" ? source.activityUrl : `${source.v1BaseUrl}/activity`,
    consultValue: cfg.consultValue,
    testRowsExcluded,
    leadsReached,
    patientsReplied,
    consultsBooked,
    consultBookingValue,
    attributedPaymentRevenue,
    consultDepositRevenue,
    monthlyPlanRevenue,
    otherPaidRevenue,
    hardPaidTreatmentRevenue,
    estimatedTreatmentOpportunity,
    treatmentOpportunityCount,
    paidTreatmentCount,
    totalMessagesExchanged,
    metaApiCostSavings: roundMoney(totalMessagesExchanged * META_MESSAGE_COST),
    sourceBreakdown: sourceBreakdown(rows),
    funnel: [
      {
        key: "source",
        label: "Leads reached",
        value: leadsReached,
        helper: source.kind === "wasup" ? "WhatsApp opener sent" : "AI actioned in V1",
      },
      {
        key: "engaged",
        label: "Patients replied",
        value: patientsReplied,
        helper: source.kind === "wasup" ? "Patient replied on WhatsApp" : "Client replied in V1",
      },
      {
        key: "booked",
        label: "Consults booked",
        value: consultsBooked,
        helper: source.kind === "wasup" ? "Dentally appointment created" : "V1 booked evidence",
      },
      {
        key: "treatment",
        label: "Treatment evidence",
        value: treatmentOpportunityCount + paidTreatmentCount,
        helper: "Treatment plans, treatment appointments, or paid invoices",
      },
      {
        key: "paid",
        label: "Paid treatment",
        value: paidTreatmentCount,
        helper: "Requires Dentally snapshot",
      },
    ],
    rows,
  };
}

function uniqueCommercialRows(rows: FunnelLeadRow[]): FunnelLeadRow[] {
  const byPatient = new Map<string, FunnelLeadRow>();
  for (const row of rows) {
    if (!hasCommercialEvidence(row)) continue;
    const key = commercialPatientKey(row);
    const current = byPatient.get(key);
    if (!current) {
      byPatient.set(key, row);
      continue;
    }
    byPatient.set(key, {
      ...current,
      consultBooked: current.consultBooked || row.consultBooked,
      consultBookingValue: current.consultBooked || row.consultBooked ? consultValueOf(row.practice) : 0,
      attributedPaymentRevenue: Math.max(current.attributedPaymentRevenue, row.attributedPaymentRevenue),
      consultDepositRevenue: Math.max(current.consultDepositRevenue, row.consultDepositRevenue),
      monthlyPlanRevenue: Math.max(current.monthlyPlanRevenue, row.monthlyPlanRevenue),
      otherPaidRevenue: Math.max(current.otherPaidRevenue, row.otherPaidRevenue),
      hardPaidRevenue: Math.max(current.hardPaidRevenue, row.hardPaidRevenue),
      estimatedTreatmentOpportunity: Math.max(current.estimatedTreatmentOpportunity, row.estimatedTreatmentOpportunity),
      treatmentEvidence: current.treatmentEvidence || row.treatmentEvidence,
      treatmentEvidenceReason: current.treatmentEvidenceReason || row.treatmentEvidenceReason,
      dentallyConsultAt: earliestDate([current.dentallyConsultAt, row.dentallyConsultAt]),
      dentallyTreatmentAt: earliestDate([current.dentallyTreatmentAt, row.dentallyTreatmentAt]),
      dentallyPaidAt: earliestDate([current.dentallyPaidAt, row.dentallyPaidAt]),
      commercialSequence: current.commercialSequence || row.commercialSequence,
      dentallyPatientId: current.dentallyPatientId || row.dentallyPatientId,
      attributionConfidence: strongerConfidence(current.attributionConfidence, row.attributionConfidence),
      attributionReason: current.attributionReason || row.attributionReason,
    });
  }
  return [...byPatient.values()];
}

/**
 * Whether a row has anything commercial to report.
 *
 * Money paid counts, not only treatment. A patient who has paid a deposit and
 * gone no further is the whole story at a practice whose consultations are free:
 * requiring treatment evidence dropped their payment from the practice totals
 * while the lead list still showed it, so the two disagreed.
 */
function hasCommercialEvidence(row: FunnelLeadRow): boolean {
  return (
    row.treatmentEvidence ||
    row.hardPaidRevenue > 0 ||
    row.estimatedTreatmentOpportunity > 0 ||
    row.attributedPaymentRevenue > 0 ||
    row.consultDepositRevenue > 0
  );
}

function commercialPatientKey(row: FunnelLeadRow): string {
  if (row.dentallyPatientId) return `dentally:${row.dentallyPatientId}`;
  if (row.email) return `email:${normalize(row.email)}`;
  if (row.phone) return `phone:${normalizePhone(row.phone)}`;
  return `name:${normalize(row.patientName)}`;
}

function strongerConfidence(a: AttributionConfidence, b: AttributionConfidence): AttributionConfidence {
  const rank: Record<AttributionConfidence, number> = { none: 0, low: 1, medium: 2, high: 3 };
  return rank[b] > rank[a] ? b : a;
}

function consultValueOf(practice: PracticeKey): number {
  return PRACTICES[practice].consultValue;
}

/**
 * Fills in Dentally evidence, within a time budget it can actually finish in.
 *
 * Asking Dentally about one patient costs a search plus three lookups, about two
 * seconds. Several hundred patients is therefore ten minutes of calls, which no
 * serverless function will survive, and a run that is killed saves nothing at
 * all: the whole point of the last attempt is lost.
 *
 * So each run starts from what the previous snapshot already learned and spends
 * its budget on the patients that need asking about — ones never checked, then
 * ones checked long enough ago that their answer may have changed. What it does
 * not reach stays queued for tomorrow, and what it did reach is saved. Over a few
 * nights the whole book gets covered, and it keeps itself covered after that.
 */
async function enrichWithDentally(
  practices: FunnelPracticeSummary[],
  plan: { limitPerPractice: number; budgetMs: number; carried: Map<string, FunnelLeadRow> },
) {
  const errors: string[] = [];
  const deadline = Date.now() + plan.budgetMs;
  const checkedAt = new Date().toISOString();
  let enrichedRows = 0;
  let attemptedRows = 0;
  let carriedRows = 0;
  let pendingRows = 0;
  const enrichedPractices: FunnelPracticeSummary[] = [];

  for (const [practiceIndex, practice] of practices.entries()) {
    const token = dentallyToken(practice.key);
    if (!token) errors.push(`${practice.label}: Dentally token missing`);
    // Only a Boxly-backed practice has notes to read a booking out of.
    const readsBoxlyNotes = PRACTICES[practice.key].source.kind === "boxly_v1";

    // An equal share of what is left, so the first practice's backlog cannot eat
    // the whole night and leave the others untouched. Time a practice does not
    // need rolls forward to the ones after it.
    const remainingMs = Math.max(0, deadline - Date.now());
    const practiceDeadline = Date.now() + remainingMs / (practices.length - practiceIndex);

    // What earlier passes already established, before spending a single call.
    const rows = practice.rows.map((row) => {
      const previous = plan.carried.get(row.id);
      if (!previous) return row;
      const withBooking = carryBookingEvidence(row, previous);
      const evidence = evidenceFromRow(previous);
      if (!evidence) return withBooking;
      carriedRows += 1;
      return applyDentallyEvidence(withBooking, evidence, previous.dentallyCheckedAt ?? null);
    });

    const queue = rows
      .filter((row) => (row.consultBooked || row.clientReplied) && needsDentallyCheck(row))
      .sort(byCheckPriority)
      .slice(0, Math.max(1, Math.min(plan.limitPerPractice, 180)));

    const done = new Map<string, FunnelLeadRow>();
    for (let index = 0; index < queue.length; index += 1) {
      const row = queue[index];
      if (!token || Date.now() >= practiceDeadline) {
        pendingRows += queue.length - index;
        break;
      }

      try {
        let enrichedRow = readsBoxlyNotes ? await applyBoxlyNoteBookingEvidence(row) : row;
        attemptedRows += 1;
        const evidence = await getDentallyEvidence(enrichedRow, token);
        if (evidence.patientId) enrichedRows += 1;
        enrichedRow = applyDentallyEvidence(enrichedRow, evidence, checkedAt);
        done.set(row.id, enrichedRow);
      } catch (error) {
        errors.push(`${practice.label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    enrichedPractices.push(
      summarizeRows(
        practice.key,
        rows.map((row) => done.get(row.id) ?? row),
        practice.testRowsExcluded,
      ),
    );
  }

  return { practices: enrichedPractices, errors, enrichedRows, attemptedRows, carriedRows, pendingRows };
}

/** How long an answer from Dentally is treated as current. */
const DENTALLY_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;

function needsDentallyCheck(row: FunnelLeadRow): boolean {
  if (!row.dentallyCheckedAt) return true;
  const checked = Date.parse(row.dentallyCheckedAt);
  if (!Number.isFinite(checked)) return true;
  return Date.now() - checked > DENTALLY_RECHECK_MS;
}

/**
 * Who to ask about first when the budget will not cover everyone: booked
 * patients, then patients who replied, then whoever has waited longest.
 */
function byCheckPriority(a: FunnelLeadRow, b: FunnelLeadRow): number {
  if (a.consultBooked !== b.consultBooked) return a.consultBooked ? -1 : 1;
  if (a.clientReplied !== b.clientReplied) return a.clientReplied ? -1 : 1;
  const aChecked = a.dentallyCheckedAt ? Date.parse(a.dentallyCheckedAt) : 0;
  const bChecked = b.dentallyCheckedAt ? Date.parse(b.dentallyCheckedAt) : 0;
  return aChecked - bChecked;
}

/**
 * A booking that only the practice's own AI note proves.
 *
 * Reading that note costs a call, and nothing in Dentally backs it up, so a run
 * that had no time to re-read it would report the patient as never booked. The
 * count would then fall and rise depending on how far the previous night got,
 * which is worse than useless in a number people are asked to trust.
 */
function carryBookingEvidence(row: FunnelLeadRow, previous: FunnelLeadRow): FunnelLeadRow {
  if (row.consultBooked || !previous.consultBooked) return row;
  return {
    ...row,
    consultBooked: true,
    consultBookingValue: consultValueOf(row.practice),
    bookedUsingSystem: true,
    attributionConfidence: strongerConfidence(row.attributionConfidence, previous.attributionConfidence),
    attributionReason: previous.attributionReason || row.attributionReason,
  };
}

/** The Dentally half of a row from an earlier snapshot, ready to re-apply. */
function evidenceFromRow(row: FunnelLeadRow): DentallyEvidence | null {
  if (!row.dentallyPatientId) return null;
  return {
    patientId: row.dentallyPatientId,
    consultBooked: row.consultBooked,
    consultCompleted: false,
    treatmentEvidence: row.treatmentEvidence,
    consultAt: row.dentallyConsultAt,
    treatmentAt: row.dentallyTreatmentAt,
    paidAt: row.dentallyPaidAt,
    attributedPaymentRevenue: row.attributedPaymentRevenue,
    consultDepositRevenue: row.consultDepositRevenue,
    monthlyPlanRevenue: row.monthlyPlanRevenue,
    otherPaidRevenue: row.otherPaidRevenue,
    paidRevenue: row.hardPaidRevenue,
    estimatedOpportunity: row.estimatedTreatmentOpportunity,
    reason: row.attributionReason,
    treatmentReason: row.treatmentEvidenceReason,
  };
}

async function applyBoxlyNoteBookingEvidence(row: FunnelLeadRow): Promise<FunnelLeadRow> {
  if (row.consultBooked && row.attributionConfidence === "high") return row;
  const cacheKey = `${row.practice}:${row.boxlyLeadId}`;
  let evidence = boxlyBookingCache.get(cacheKey);
  if (!evidence) {
    const notes = await getFunnelLeadNotes(row.practice, row.boxlyLeadId);
    const match = notes.find((note) => isBookingText([note.title, note.description].filter(Boolean).join(" ")));
    evidence = match
      ? {
          booked: true,
          reason: `Boxly note contains AI booking confirmation: ${truncate(match.description || match.title)}`,
        }
      : { booked: false, reason: "No AI booking confirmation found in Boxly notes" };
    boxlyBookingCache.set(cacheKey, evidence);
  }
  if (!evidence.booked) return row;
  return {
    ...row,
    consultBooked: true,
    consultBookingValue: consultValueOf(row.practice),
    bookedUsingSystem: true,
    attributionConfidence: "high",
    attributionReason: evidence.reason,
  };
}

/**
 * Folds Dentally's answer into what the row already proved.
 *
 * The payment figures are merged with the larger of the two rather than
 * replaced. A row can arrive already carrying evidence — Dental Aesthetica's
 * deposits come from the Stripe record our own workflow wrote — and Dentally
 * does not always know about it: a deposit taken by Stripe is not guaranteed to
 * be recorded as a Dentally invoice. Overwriting would erase a payment that
 * definitely happened, while adding would count the same £30 twice whenever
 * Dentally did record it.
 */
function applyDentallyEvidence(
  row: FunnelLeadRow,
  evidence: DentallyEvidence,
  checkedAt: string | null,
): FunnelLeadRow {
  if (!evidence.patientId) return row;
  const consultBooked = row.consultBooked || evidence.consultBooked;
  const consultAt = earliestDate([row.dentallyConsultAt, evidence.consultAt]);
  const paidAt = earliestDate([row.dentallyPaidAt, evidence.paidAt]);
  return {
    ...row,
    consultBooked,
    consultBookingValue: consultBooked ? consultValueOf(row.practice) : 0,
    bookedUsingSystem: consultBooked,
    attributionConfidence: evidence.reason.includes("WhatsApp") || row.attributionConfidence === "high" ? "high" : "medium",
    // Keep the row's own reason when it already proves the booking outright.
    attributionReason:
      row.attributionConfidence === "high" ? row.attributionReason : evidence.reason || row.attributionReason,
    attributedPaymentRevenue: Math.max(row.attributedPaymentRevenue, evidence.attributedPaymentRevenue),
    consultDepositRevenue: Math.max(row.consultDepositRevenue, evidence.consultDepositRevenue),
    monthlyPlanRevenue: Math.max(row.monthlyPlanRevenue, evidence.monthlyPlanRevenue),
    otherPaidRevenue: Math.max(row.otherPaidRevenue, evidence.otherPaidRevenue),
    hardPaidRevenue: Math.max(row.hardPaidRevenue, evidence.paidRevenue),
    estimatedTreatmentOpportunity: Math.max(row.estimatedTreatmentOpportunity, evidence.estimatedOpportunity),
    treatmentEvidence: row.treatmentEvidence || evidence.treatmentEvidence || evidence.paidRevenue > 0,
    treatmentEvidenceReason: evidence.treatmentReason ?? row.treatmentEvidenceReason,
    dentallyConsultAt: consultAt,
    dentallyTreatmentAt: earliestDate([row.dentallyTreatmentAt, evidence.treatmentAt]),
    dentallyPaidAt: paidAt,
    commercialSequence: commercialSequence(row.aiActionedAt || row.actionedAt, consultAt, evidence.treatmentAt, paidAt),
    dentallyPatientId: evidence.patientId,
    dentallyStatus: "pending",
    dentallyCheckedAt: checkedAt ?? row.dentallyCheckedAt ?? null,
  };
}

async function getDentallyEvidence(row: FunnelLeadRow, token: string): Promise<DentallyEvidence> {
  const cacheKey = dentallyCacheKey(row);
  const cachedEvidence = dentallyCache.get(cacheKey);
  if (cachedEvidence) return cachedEvidence;

  const patient = await findDentallyPatient(row, token);
  if (!patient?.id) {
    const evidence = noDentallyEvidence("No Dentally patient match");
    dentallyCache.set(cacheKey, evidence);
    return evidence;
  }

  const patientId = String(patient.id);
  const [appointments, invoices, treatmentPlans] = await Promise.all([
    dentallyList("appointments", token, { patient_id: patientId, cancelled: "true" }),
    dentallyList("invoices", token, { patient_id: patientId }),
    dentallyList("treatment_plans", token, { patient_id: patientId }),
  ]);

  const startAt = row.aiActionedAt || row.actionedAt || row.becameLeadAt;
  const postAiAppointments = appointments.filter((appointment) => isOnOrAfter(stringValue(asRecord(appointment).start_time), startAt));
  const consultAppointments = postAiAppointments.filter(isConsultAppointment);
  const treatmentAppointments = postAiAppointments.filter(isTreatmentAppointment);
  const postAiPlans = treatmentPlans.filter((plan) => isOnOrAfter(treatmentPlanDate(asRecord(plan)), startAt));
  const invoiceEvidence = paidRevenueFromInvoices(invoices, startAt);
  const treatmentPlanValue = treatmentPlanValueFromPlans(postAiPlans);
  const consultAt = earliestDate(consultAppointments.map((appointment) => stringValue(asRecord(appointment).start_time)));
  const treatmentAt = earliestDate([
    ...treatmentAppointments.map((appointment) => stringValue(asRecord(appointment).start_time)),
    ...postAiPlans.map((plan) => treatmentPlanDate(asRecord(plan))),
  ]);
  const treatmentEvidence =
    treatmentAppointments.length > 0 ||
    postAiPlans.length > 0 ||
    invoiceEvidence.monthlyPlanEvidence ||
    invoiceEvidence.otherPaidRevenue > 0 ||
    invoiceEvidence.paidRevenue > 0;
  const paidRevenue = invoiceEvidence.paidRevenue;
  const treatmentReason =
    treatmentAppointments.length > 0
      ? "Post-AI Dentally treatment appointment found"
      : postAiPlans.length > 0
        ? treatmentPlanValue > 0
          ? "Post-AI Dentally treatment plan with actual value found"
          : "Post-AI Dentally treatment plan found; value not available"
        : invoiceEvidence.monthlyPlanEvidence
          ? "Post-AI £154 monthly treatment-on-plan payment found"
          : invoiceEvidence.otherPaidRevenue > 0
            ? "Post-AI paid Dentally invoice found below full-treatment threshold"
          : paidRevenue > 0
          ? "Post-AI paid Dentally invoice found"
          : null;

  const evidence: DentallyEvidence = {
    patientId,
    consultBooked: consultAppointments.length > 0,
    consultCompleted: consultAppointments.some((appointment) => /complete|attend|arrived/i.test(stringValue(asRecord(appointment).state))),
    treatmentEvidence,
    consultAt,
    treatmentAt,
    paidAt: invoiceEvidence.paidAt,
    attributedPaymentRevenue: invoiceEvidence.attributedPaymentRevenue,
    consultDepositRevenue: invoiceEvidence.consultDepositRevenue,
    monthlyPlanRevenue: invoiceEvidence.monthlyPlanRevenue,
    otherPaidRevenue: invoiceEvidence.otherPaidRevenue,
    paidRevenue,
    estimatedOpportunity: paidRevenue > 0 ? 0 : treatmentPlanValue,
    reason:
      consultAppointments.find((appointment) => /whatsapp|ai/i.test(stringValue(asRecord(appointment).notes))) !== undefined
        ? "Dentally appointment notes mention WhatsApp/AI"
        : consultAppointments.length > 0
          ? "Post-AI Dentally consultation appointment found"
          : treatmentEvidence
            ? "Post-AI Dentally treatment evidence found"
            : paidRevenue > 0
              ? "Post-AI paid Dentally invoice found"
              : "Dentally patient matched; no post-AI commercial evidence counted",
    treatmentReason,
  };
  dentallyCache.set(cacheKey, evidence);
  return evidence;
}

async function findDentallyPatient(row: FunnelLeadRow, token: string): Promise<Record<string, unknown> | null> {
  // A row that already knows its patient id was booked by us against that
  // patient. Searching by name instead risks matching a different person.
  if (row.dentallyPatientId) {
    const known = await fetchDentally(
      `https://api.dentally.co/v1/patients/${encodeURIComponent(row.dentallyPatientId)}`,
      token,
    ).catch(() => null);
    const patient = asRecord(asRecord(known).patient ?? known);
    if (patient.id) return patient;
  }

  const searches = [row.email, row.phone, row.patientName].filter(Boolean) as string[];
  for (const query of searches) {
    const url = new URL("https://api.dentally.co/v1/patients");
    url.searchParams.set("query", query);
    url.searchParams.set("per_page", "10");
    const payload = await fetchDentally(url.toString(), token);
    const patients = arrayFromPayload(payload, "patients").map(asRecord);
    const match = patients.find((patient) => patientMatchesRow(patient, row));
    if (match) return match;
  }
  return null;
}

async function dentallyList(path: string, token: string, params: Record<string, string>) {
  const url = new URL(`https://api.dentally.co/v1/${path}`);
  url.searchParams.set("per_page", "100");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const payload = await fetchDentally(url.toString(), token);
  return arrayFromPayload(payload, path);
}

async function fetchDentally(url: string, token: string) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Dentally GET failed: ${response.status}`);
  return response.json();
}

function mapLead(practice: PracticeKey, practiceLabel: string, lead: V1Lead): FunnelLeadRow {
  const boxlyLeadId = stringValue(lead.boxly_lead_id) || stringValue(lead.id);
  const actionedNote = stringValue(lead.actioned_note) || null;
  const boxStage = stringValue(lead.box_stage) || null;
  const bookedByNote = isBookingText(actionedNote);
  const bookedByStage = /consultation booked|booked|appointment booked/i.test(boxStage ?? "");
  const aiActioned = Boolean(lead.ai_actioned);
  const clientReplied = clientRepliedFromRaw(lead.raw_data);
  const consultBooked = Boolean(aiActioned && (bookedByNote || bookedByStage));
  const attributionConfidence: AttributionConfidence = bookedByNote
    ? "high"
    : consultBooked && clientReplied
      ? "medium"
      : consultBooked
        ? "low"
        : "none";
  const attributionReason = bookedByNote
    ? "AI note contains booking/confirmation language"
    : consultBooked
      ? "V1/Boxly stage indicates consultation booked after AI action"
      : "No booked-consult evidence in current V1 snapshot";

  return {
    id: `${practice}:${boxlyLeadId}`,
    practice,
    practiceLabel,
    boxlyLeadId,
    patientName: stringValue(lead.full_name) || "Unknown",
    phone: stringValue(lead.phone_e164) || stringValue(lead.phone_number) || null,
    email: stringValue(lead.email) || null,
    leadSource: stringValue(lead.lead_source) || "Unknown",
    boxName: stringValue(lead.box_name) || null,
    boxStage,
    leadSummary: stringValue(lead.lead_summary) || null,
    aiActioned,
    clientReplied,
    conversationCount: numberValue(lead.conversation_count),
    becameLeadAt: stringValue(lead.became_lead_at) || null,
    actionedAt: stringValue(lead.actioned_at) || null,
    aiActionedAt: stringValue(lead.ai_actioned_at) || null,
    lastUpdatedAt: stringValue(lead.last_updated_at) || null,
    actionedNote,
    consultBooked,
    consultBookingValue: consultBooked ? consultValueOf(practice) : 0,
    bookedUsingSystem: consultBooked,
    attributionConfidence,
    attributionReason,
    attributedPaymentRevenue: 0,
    consultDepositRevenue: 0,
    monthlyPlanRevenue: 0,
    otherPaidRevenue: 0,
    hardPaidRevenue: 0,
    estimatedTreatmentOpportunity: 0,
    treatmentEvidence: false,
    treatmentEvidenceReason: null,
    dentallyConsultAt: null,
    dentallyTreatmentAt: null,
    dentallyPaidAt: null,
    commercialSequence: "No Dentally commercial sequence evidence",
    dentallyPatientId: null,
    dentallyStatus: "not_enriched",
  };
}

function sourceBreakdown(rows: FunnelLeadRow[]) {
  const map = new Map<string, { source: string; leads: number; replied: number; booked: number }>();
  for (const row of rows) {
    const source = displaySourceName(row.leadSource);
    const item = map.get(source) ?? { source, leads: 0, replied: 0, booked: 0 };
    item.leads += row.aiActioned ? 1 : 0;
    item.replied += row.clientReplied ? 1 : 0;
    item.booked += row.consultBooked ? 1 : 0;
    map.set(source, item);
  }
  return [...map.values()].sort((a, b) => b.leads - a.leads).slice(0, 8);
}

function displaySourceName(source: string | null | undefined): string {
  const normalized = normalize(source || "");
  if (!normalized) return "Unknown";
  const aliases: Record<string, string> = {
    "facebook lead ads": "Facebook Lead Ads",
    "direct traffic": "Direct Traffic",
    "google paid search": "Google Paid Search",
    manual: "Manual",
    whatsapp: "WhatsApp",
    "whats app": "WhatsApp",
    wa: "WhatsApp",
    instagram: "Instagram",
    "referred by a dentist": "Referred by a dentist",
  };
  return aliases[normalized] || titleCaseSource(source || "Unknown");
}

function titleCaseSource(source: string): string {
  return source
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((part) => (part.length <= 2 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
    .join(" ");
}

function withCache(
  result: Omit<FunnelResult, "cache">,
  status: FunnelResult["cache"]["status"],
  ageMs: number,
): FunnelResult {
  return {
    ...result,
    cache: {
      status,
      ageMs: Math.max(0, ageMs),
      ttlMs: CACHE_TTL_MS,
    },
  };
}

async function loadPersistedSnapshot(): Promise<{
  result: Omit<FunnelResult, "cache">;
  generatedAtMs: number;
  status: FunnelResult["cache"]["status"];
} | null> {
  const supabase = supabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from("admin_attribution_snapshots")
      .select("payload, generated_at")
      .eq("snapshot_key", SNAPSHOT_KEY)
      .maybeSingle();
    if (!error && data?.payload && typeof data.payload === "object") {
      const parsed = data.payload as Omit<FunnelResult, "cache">;
      if (parsed?.generatedAt && Array.isArray(parsed.practices)) {
        const generatedAtMs = Date.parse(String(data.generated_at || parsed.generatedAt));
        if (Number.isFinite(generatedAtMs)) {
          return {
            // Snapshots written before warnings existed have none.
            result: { ...parsed, warnings: parsed.warnings ?? [] },
            generatedAtMs,
            status: Date.now() - generatedAtMs <= CACHE_TTL_MS ? "fresh" : "stale",
          };
        }
      }
    }
  }

  try {
    const raw = await readFile(SNAPSHOT_PATH, "utf8");
    const parsed = JSON.parse(raw) as Omit<FunnelResult, "cache">;
    if (!parsed?.generatedAt || !Array.isArray(parsed.practices)) return null;
    const generatedAtMs = Date.parse(parsed.generatedAt);
    if (!Number.isFinite(generatedAtMs)) return null;
    return {
      result: { ...parsed, warnings: parsed.warnings ?? [] },
      generatedAtMs,
      status: Date.now() - generatedAtMs <= CACHE_TTL_MS ? "fresh" : "stale",
    };
  } catch {
    return null;
  }
}

async function persistSnapshot(result: Omit<FunnelResult, "cache">): Promise<void> {
  let persisted = false;
  const supabase = supabaseAdmin();
  if (supabase) {
    const { error } = await supabase.from("admin_attribution_snapshots").upsert({
      snapshot_key: SNAPSHOT_KEY,
      generated_at: result.generatedAt,
      payload: result,
    });
    if (!error) persisted = true;
  }

  try {
    await mkdir(dirname(SNAPSHOT_PATH), { recursive: true });
    await writeFile(SNAPSHOT_PATH, JSON.stringify(result, null, 2));
    persisted = true;
  } catch (error) {
    if (!persisted) throw error;
  }
}

function noSnapshotResult(): Omit<FunnelResult, "cache"> {
  return {
    generatedAt: new Date().toISOString(),
    dentally: {
      status: "not_enriched",
      message: "No merged attribution snapshot has been generated yet.",
    },
    practices: [],
    warnings: [],
  };
}

function isBookingText(value: string | null): boolean {
  const text = (value ?? "").toLowerCase();
  return (
    /\b(all booked|booked in|booked for|appointment is confirmed|appointment confirmed|consultation is confirmed)\b/.test(
      text,
    ) && /\b(consult|consultation|appointment|dr|dentist|records)\b/.test(text)
  );
}

function clientRepliedFromRaw(raw: Record<string, unknown> | null | undefined): boolean {
  return raw?.client_replied === true || raw?.client_replied === "true";
}

function dentallyToken(practice: PracticeKey): string | null {
  for (const key of PRACTICES[practice].dentallyTokenEnvs) {
    const value = process.env[key];
    if (value?.trim()) return value.trim();
  }
  return null;
}

function dentallyCacheKey(row: FunnelLeadRow): string {
  return [row.practice, normalizePhone(row.phone), normalizeEmail(row.email), normalize(row.patientName)]
    .filter(Boolean)
    .join("|");
}

function noDentallyEvidence(reason: string): DentallyEvidence {
  return {
    patientId: null,
    consultBooked: false,
    consultCompleted: false,
    treatmentEvidence: false,
    consultAt: null,
    treatmentAt: null,
    paidAt: null,
    attributedPaymentRevenue: 0,
    consultDepositRevenue: 0,
    monthlyPlanRevenue: 0,
    otherPaidRevenue: 0,
    paidRevenue: 0,
    estimatedOpportunity: 0,
    reason,
    treatmentReason: null,
  };
}

function patientMatchesRow(patient: Record<string, unknown>, row: FunnelLeadRow): boolean {
  const email = normalizeEmail(stringValue(patient.email));
  if (email && row.email && email === normalizeEmail(row.email)) return true;

  const patientPhone = normalizePhone(
    stringValue(patient.mobile) || stringValue(patient.phone) || stringValue(patient.telephone),
  );
  const rowPhone = normalizePhone(row.phone);
  if (patientPhone && rowPhone && (patientPhone.endsWith(rowPhone) || rowPhone.endsWith(patientPhone))) return true;

  const patientName = normalize(
    [
      stringValue(patient.name),
      stringValue(patient.full_name),
      stringValue(patient.first_name),
      stringValue(patient.last_name),
    ]
      .filter(Boolean)
      .join(" "),
  );
  const rowName = normalize(row.patientName);
  return Boolean(patientName && rowName && (patientName.includes(rowName) || rowName.includes(patientName)));
}

function isConsultAppointment(appointment: unknown): boolean {
  const record = asRecord(appointment);
  const text = normalize([record.reason, record.notes].map(stringValue).join(" "));
  const state = normalize(stringValue(record.state));
  if (/cancel|deleted|did not attend|no show/.test(state)) return false;
  return /consult|consultation|scan|assessment|records|whatsapp ai|booked via whatsapp/.test(text);
}

function isTreatmentAppointment(appointment: unknown): boolean {
  if (isConsultAppointment(appointment)) return false;
  const record = asRecord(appointment);
  const text = normalize([record.reason, record.notes].map(stringValue).join(" "));
  return /\b(aligner fit|fit appointment|attachments?|clincheck|refinement|treatment started|treatment plan accepted|composite bonding|whitening|implants?|veneers?)\b/.test(
    text,
  );
}

function paidRevenueFromInvoices(invoices: unknown[], startAt: string | null) {
  let attributedPaymentRevenue = 0;
  const paidDates: string[] = [];
  for (const invoice of invoices) {
    const record = asRecord(invoice);
    const date = invoiceDate(record);
    if (!isOnOrAfter(date, startAt)) continue;
    const total = moneyValue(record.total ?? record.amount ?? record.total_amount);
    const outstanding = moneyValue(record.amount_outstanding);
    const paid = record.paid === true || outstanding === 0;
    if (!paid || total <= 0) continue;
    attributedPaymentRevenue += total;
    if (date) paidDates.push(date);
  }
  attributedPaymentRevenue = roundMoney(attributedPaymentRevenue);
  const consultDepositRevenue = isConsultDeposit(attributedPaymentRevenue) ? attributedPaymentRevenue : 0;
  const monthlyPlanRevenue = isMonthlyTreatmentPlanPayment(attributedPaymentRevenue) ? attributedPaymentRevenue : 0;
  const paidRevenue = isHardTreatmentInvoice(attributedPaymentRevenue) ? attributedPaymentRevenue : 0;
  const otherPaidRevenue =
    attributedPaymentRevenue > 0 && consultDepositRevenue <= 0 && monthlyPlanRevenue <= 0 && paidRevenue <= 0
      ? attributedPaymentRevenue
      : 0;
  return {
    paidRevenue,
    attributedPaymentRevenue,
    consultDepositRevenue,
    monthlyPlanRevenue,
    otherPaidRevenue,
    paidAt: earliestDate(paidDates),
    monthlyPlanEvidence: monthlyPlanRevenue > 0,
  };
}

function treatmentPlanValueFromPlans(plans: unknown[]): number {
  let value = 0;
  for (const plan of plans) {
    const record = asRecord(plan);
    const direct = moneyValue(
      record.total ??
        record.total_amount ??
        record.amount ??
        record.value ??
        record.price ??
        record.patient_total ??
        record.gross_total ??
        record.net_total ??
        record.estimated_total,
    );
    if (direct > 0) {
      value += direct;
      continue;
    }
    const items = Array.isArray(record.items)
      ? record.items
      : Array.isArray(record.line_items)
        ? record.line_items
        : Array.isArray(record.treatments)
          ? record.treatments
          : [];
    value += items.reduce((sum, item) => {
      const itemRecord = asRecord(item);
      return sum + moneyValue(itemRecord.total ?? itemRecord.amount ?? itemRecord.value ?? itemRecord.price);
    }, 0);
  }
  return roundMoney(value);
}

function isConsultDeposit(total: number): boolean {
  return isApproxMoney(total, 30) || isApproxMoney(total, CONSULT_FEE_GBP);
}

function isMonthlyTreatmentPlanPayment(total: number): boolean {
  return isApproxMoney(total, 154);
}

function isHardTreatmentInvoice(total: number): boolean {
  return total >= 1000;
}

function isApproxMoney(value: number, expected: number): boolean {
  return Math.abs(value - expected) < 0.01;
}

function invoiceDate(invoice: Record<string, unknown>): string | null {
  return (
    stringValue(invoice.invoice_date) ||
    stringValue(invoice.date) ||
    stringValue(invoice.issued_on) ||
    stringValue(invoice.issued_at) ||
    stringValue(invoice.paid_at) ||
    stringValue(invoice.payment_date) ||
    stringValue(invoice.created_at) ||
    stringValue(invoice.updated_at) ||
    null
  );
}

function treatmentPlanDate(plan: Record<string, unknown>): string | null {
  return (
    stringValue(plan.accepted_at) ||
    stringValue(plan.completed_at) ||
    stringValue(plan.updated_at) ||
    stringValue(plan.created_at) ||
    null
  );
}

function isOnOrAfter(value: string | null, startAt: string | null): boolean {
  if (!startAt) return true;
  if (!value) return false;
  const date = Date.parse(value);
  const start = Date.parse(startAt);
  if (!Number.isFinite(date) || !Number.isFinite(start)) return false;
  return date >= start;
}

function earliestDate(values: Array<string | null | undefined>): string | null {
  const sorted = values
    .filter((value): value is string => Boolean(value && Number.isFinite(Date.parse(value))))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return sorted[0] ?? null;
}

function commercialSequence(
  aiActionedAt: string | null,
  consultAt: string | null,
  treatmentAt: string | null,
  paidAt: string | null,
): string {
  if (!paidAt && !consultAt && !treatmentAt) return "No Dentally commercial sequence evidence";
  if (!paidAt) {
    if (consultAt && treatmentAt) return "AI/message evidence → consult evidence → treatment evidence; no paid invoice found";
    if (consultAt) return "AI/message evidence → consult evidence; no paid invoice found";
    if (treatmentAt) return "AI/message evidence → treatment evidence; no paid invoice found";
    return "No paid invoice found";
  }

  const aiBeforePaid = isOnOrBefore(aiActionedAt, paidAt);
  const consultBeforePaid = isOnOrBefore(consultAt, paidAt);
  const treatmentBeforePaid = isOnOrBefore(treatmentAt, paidAt);

  if (aiBeforePaid && consultBeforePaid) return "AI/message evidence → consult evidence → paid invoice";
  if (aiBeforePaid && treatmentBeforePaid) return "AI/message evidence → treatment evidence → paid invoice";
  if (aiBeforePaid) return "AI/message evidence → paid invoice; consult date not found";
  return "Paid invoice found; sequence before payment not proven";
}

function isOnOrBefore(value: string | null, endAt: string | null): boolean {
  if (!value || !endAt) return false;
  const date = Date.parse(value);
  const end = Date.parse(endAt);
  if (!Number.isFinite(date) || !Number.isFinite(end)) return false;
  return date <= end;
}

function arrayFromPayload(payload: unknown, key: string): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  const keyed = record[key];
  if (Array.isArray(keyed)) return keyed;
  if (Array.isArray(record.data)) return record.data;
  return [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function moneyValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeEmail(value: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizePhone(value: string | null): string {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function normalize(value: string | null): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function truncate(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

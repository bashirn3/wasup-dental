import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { supabaseAdmin } from "./supabase";

export type PracticeKey = "regent" | "nuyu";

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
};

export type FunnelPracticeSummary = {
  key: PracticeKey;
  label: string;
  v1ActivityUrl: string;
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
  };
  practices: FunnelPracticeSummary[];
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

const PRACTICES: Record<PracticeKey, { label: string; v1BaseUrl: string }> = {
  regent: {
    label: "Regent Dental",
    v1BaseUrl: "https://boxly-agent.vercel.app",
  },
  nuyu: {
    label: "NuYu Dental",
    v1BaseUrl: "https://nuyu-boxly-agent-lyart.vercel.app",
  },
};

const PAGE_SIZE = 200;
const CACHE_TTL_MS = 2 * 60 * 1000;
const CONSULT_BOOKING_VALUE = 65;
const META_MESSAGE_COST = 0.07;
const SNAPSHOT_PATH = join(process.cwd(), ".cache", "admin-attribution-funnel-snapshot.json");
const SNAPSHOT_KEY = "admin-attribution-funnel";

let cached: { generatedAtMs: number; result: Omit<FunnelResult, "cache"> } | null = null;
let inFlight: Promise<Omit<FunnelResult, "cache">> | null = null;
const dentallyCache = new Map<string, DentallyEvidence>();
const boxlyBookingCache = new Map<string, { booked: boolean; reason: string }>();

export async function getAdminAttributionFunnel(
  options: { refresh?: boolean; enrichDentally?: boolean; dentallyLimit?: number } = {},
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

  inFlight = buildFunnel(enrichDentally, options.dentallyLimit ?? 180);
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
  const safeLeadId = encodeURIComponent(leadId);
  const url = `${cfg.v1BaseUrl}/api/v1/agent/activity/${safeLeadId}/notes`;
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

async function buildFunnel(enrichDentally: boolean, dentallyLimit: number): Promise<Omit<FunnelResult, "cache">> {
  let practices = await Promise.all(
    (Object.keys(PRACTICES) as PracticeKey[]).map(async (key) => {
      const leads = await fetchAllV1Leads(key);
      return summarizePractice(key, leads);
    }),
  );

  let dentally: Omit<FunnelResult["dentally"], "status"> & { status: FunnelResult["dentally"]["status"] } = {
    status: "not_enriched",
    message:
      "V1/Boxly engagement is loaded. Paid treatment revenue and treatment opportunity are pending until the safe cached Dentally snapshot is run.",
  };

  if (enrichDentally) {
    const enrichment = await enrichWithDentally(practices, dentallyLimit);
    practices = enrichment.practices;
    dentally = {
      status: enrichment.errors.length ? "partial" : "enriched",
      message: enrichment.errors.length
        ? `Dentally snapshot partially enriched ${enrichment.enrichedRows}/${enrichment.attemptedRows} selected rows. ${enrichment.errors[0]}`
        : `Dentally snapshot enriched ${enrichment.enrichedRows}/${enrichment.attemptedRows} selected rows.`,
      enrichedRows: enrichment.enrichedRows,
      attemptedRows: enrichment.attemptedRows,
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    dentally,
    practices,
  };
}

async function fetchAllV1Leads(practice: PracticeKey): Promise<V1Lead[]> {
  const cfg = PRACTICES[practice];
  const all: V1Lead[] = [];
  for (let page = 1; ; page += 1) {
    const url = new URL(`${cfg.v1BaseUrl}/api/v1/agent/activity-fast`);
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

function summarizeRows(practice: PracticeKey, rows: FunnelLeadRow[]): FunnelPracticeSummary {
  const cfg = PRACTICES[practice];
  const leadsReached = rows.filter((row) => row.aiActioned).length;
  const patientsReplied = rows.filter((row) => row.clientReplied).length;
  const consultsBooked = rows.filter((row) => row.consultBooked).length;
  const totalMessagesExchanged = rows.reduce((sum, row) => sum + row.conversationCount, 0);
  const consultBookingValue = consultsBooked * CONSULT_BOOKING_VALUE;
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
    v1ActivityUrl: `${cfg.v1BaseUrl}/activity`,
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
      { key: "source", label: "Leads reached", value: leadsReached, helper: "AI actioned in V1" },
      { key: "engaged", label: "Patients replied", value: patientsReplied, helper: "Client replied in V1" },
      { key: "booked", label: "Consults booked", value: consultsBooked, helper: "V1 booked evidence" },
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
    if (!row.treatmentEvidence && row.hardPaidRevenue <= 0 && row.estimatedTreatmentOpportunity <= 0) continue;
    const key = commercialPatientKey(row);
    const current = byPatient.get(key);
    if (!current) {
      byPatient.set(key, row);
      continue;
    }
    byPatient.set(key, {
      ...current,
      consultBooked: current.consultBooked || row.consultBooked,
      consultBookingValue: current.consultBooked || row.consultBooked ? CONSULT_BOOKING_VALUE : 0,
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

async function enrichWithDentally(practices: FunnelPracticeSummary[], limitPerPractice: number) {
  const errors: string[] = [];
  let enrichedRows = 0;
  let attemptedRows = 0;
  const enrichedPractices: FunnelPracticeSummary[] = [];

  for (const practice of practices) {
    const token = dentallyToken(practice.key);
    if (!token) errors.push(`${practice.label}: Dentally token missing`);

    const bookingScanCandidates = practice.rows
      .filter((row) => row.consultBooked || row.clientReplied)
      .slice(0, Math.max(1, Math.min(limitPerPractice, 180)));
    const candidateIds = new Set(bookingScanCandidates.map((row) => row.id));
    const rows: FunnelLeadRow[] = [];

    for (const row of practice.rows) {
      if (!candidateIds.has(row.id)) {
        rows.push(row);
        continue;
      }

      try {
        let enrichedRow = await applyBoxlyNoteBookingEvidence(row);
        if (token) {
          attemptedRows += 1;
          const evidence = await getDentallyEvidence(enrichedRow, token);
          if (evidence.patientId) enrichedRows += 1;
          enrichedRow = applyDentallyEvidence(enrichedRow, evidence);
        }
        rows.push(enrichedRow);
      } catch (error) {
        errors.push(`${practice.label}: ${error instanceof Error ? error.message : String(error)}`);
        rows.push(row);
      }
    }

    enrichedPractices.push(summarizeRows(practice.key, rows));
  }

  return { practices: enrichedPractices, errors, enrichedRows, attemptedRows };
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
    consultBookingValue: CONSULT_BOOKING_VALUE,
    bookedUsingSystem: true,
    attributionConfidence: "high",
    attributionReason: evidence.reason,
  };
}

function applyDentallyEvidence(row: FunnelLeadRow, evidence: DentallyEvidence): FunnelLeadRow {
  if (!evidence.patientId) return row;
  const consultBooked = row.consultBooked || evidence.consultBooked;
  return {
    ...row,
    consultBooked,
    consultBookingValue: consultBooked ? CONSULT_BOOKING_VALUE : 0,
    bookedUsingSystem: consultBooked,
    attributionConfidence: evidence.reason.includes("WhatsApp") || row.attributionConfidence === "high" ? "high" : "medium",
    attributionReason: evidence.reason || row.attributionReason,
    attributedPaymentRevenue: evidence.attributedPaymentRevenue,
    consultDepositRevenue: evidence.consultDepositRevenue,
    monthlyPlanRevenue: evidence.monthlyPlanRevenue,
    otherPaidRevenue: evidence.otherPaidRevenue,
    hardPaidRevenue: evidence.paidRevenue,
    estimatedTreatmentOpportunity: evidence.estimatedOpportunity,
    treatmentEvidence: evidence.treatmentEvidence || evidence.paidRevenue > 0,
    treatmentEvidenceReason: evidence.treatmentReason,
    dentallyConsultAt: evidence.consultAt,
    dentallyTreatmentAt: evidence.treatmentAt,
    dentallyPaidAt: evidence.paidAt,
    commercialSequence: commercialSequence(row.aiActionedAt || row.actionedAt, evidence.consultAt, evidence.treatmentAt, evidence.paidAt),
    dentallyPatientId: evidence.patientId,
    dentallyStatus: "pending",
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
    consultBookingValue: consultBooked ? CONSULT_BOOKING_VALUE : 0,
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
    const source = row.leadSource || "Unknown";
    const item = map.get(source) ?? { source, leads: 0, replied: 0, booked: 0 };
    item.leads += row.aiActioned ? 1 : 0;
    item.replied += row.clientReplied ? 1 : 0;
    item.booked += row.consultBooked ? 1 : 0;
    map.set(source, item);
  }
  return [...map.values()].sort((a, b) => b.leads - a.leads).slice(0, 8);
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
            result: parsed,
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
      result: parsed,
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
  const candidates =
    practice === "regent"
      ? ["REGENT_DENTALLY_API_TOKEN", "DENTALLY_REGENT_API_TOKEN", "DENTALLY_API_TOKEN_REGENT"]
      : ["NUYU_DENTALLY_API_TOKEN", "DENTALLY_NUYU_API_TOKEN", "DENTALLY_API_TOKEN_NUYU"];
  for (const key of candidates) {
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
  return isApproxMoney(total, 30) || isApproxMoney(total, CONSULT_BOOKING_VALUE);
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

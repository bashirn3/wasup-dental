import { createClient } from "@supabase/supabase-js";
import type { AttributionConfidence, FunnelLeadRow, FunnelNote } from "./admin-attribution-funnel";
import { loadBookingSourceAccess } from "./leadflo-mirror";
import { supabaseAdmin } from "./supabase";

/**
 * Dental Aesthetica's half of the attribution funnel.
 *
 * Regent and NuYu are read from their Boxly V1 app, which reports who the AI
 * reached, who replied, and infers a booking from the language in its own note.
 * Dental Aesthetica has no such app. Everything it knows lives in two places we
 * already own:
 *
 *   - our leads and messages tables, mirrored from the Leadflo feeder, which is
 *     where Poppy's opener and the patient's replies are recorded;
 *   - the booking table the WhatsApp workflow writes to, which holds the chosen
 *     slot, the Stripe deposit, and the Dentally appointment id.
 *
 * That second source makes this practice's attribution stronger than the other
 * two rather than weaker. Regent's bookings are inferred by matching phrases in
 * an AI note; here a booking is a Dentally appointment id that our own workflow
 * created, and a payment is a timestamped Stripe deposit.
 */

export const DENTAL_AESTHETICA_PRACTICE_NAME = "Dental Aesthetica";

const PRACTICE_KEY = "dental_aesthetica";
const PRACTICE_LABEL = DENTAL_AESTHETICA_PRACTICE_NAME;
const PAGE_SIZE = 1000;

/**
 * What the practice charges for a consultation: nothing. The only money at
 * consultation stage is a £30 refundable deposit, taken to stop no-shows and
 * returned or set against treatment. It is therefore reported as a deposit and
 * never as a per-consult value, which would be a fee this practice never charges.
 */
export const DENTAL_AESTHETICA_CONSULT_VALUE = 0;

type LegacyPayload = {
  enquiredAt?: unknown;
  becameLeadAt?: unknown;
  firstSeenAt?: unknown;
  actionedAt?: unknown;
  outboundSentAt?: unknown;
  outboundStatus?: unknown;
  lastUpdatedAt?: unknown;
  stage?: unknown;
  treatmentType?: unknown;
  isTestName?: unknown;
};

type LeadRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  external_payload: { legacy?: LegacyPayload } | null;
  updated_at: string | null;
};

type MessageRow = {
  lead_id: string | null;
  direction: string | null;
  created_at: string | null;
};

type BookingRow = {
  number: string | null;
  dentally_appointment_id: string | number | null;
  dentally_patient_id: string | number | null;
  deposit_status: string | null;
  deposit_amount: number | string | null;
  deposit_paid_at: string | null;
  chosen_start_time: string | null;
  booking_error: string | null;
};

type Conversation = {
  outbound: number;
  inbound: number;
  firstOutboundAt: string | null;
  lastAt: string | null;
};

export type DentalAestheticaFunnel = {
  rows: FunnelLeadRow[];
  /**
   * Our own test leads, left out rather than counted. Reported so the funnel can
   * say why its lead count is lower than the practice dashboard's.
   */
  testRowsExcluded: number;
};

export async function buildDentalAestheticaRows(): Promise<DentalAestheticaFunnel> {
  const supabase = supabaseAdmin();
  if (!supabase) throw new Error("storage_unavailable");

  const { data: practice, error: practiceError } = await supabase
    .from("practices")
    .select("id")
    .eq("name", DENTAL_AESTHETICA_PRACTICE_NAME)
    .maybeSingle<{ id: string }>();
  if (practiceError) throw new Error(`practice_lookup_failed:${practiceError.message}`);
  if (!practice?.id) return { rows: [], testRowsExcluded: 0 };

  const [leads, conversations, bookings] = await Promise.all([
    fetchLeads(practice.id),
    fetchConversations(practice.id),
    fetchBookings(practice.id),
  ]);

  let testRowsExcluded = 0;
  const rows: FunnelLeadRow[] = [];
  for (const lead of leads) {
    if (isTestLead(lead)) {
      testRowsExcluded += 1;
      continue;
    }
    rows.push(
      toFunnelRow(lead, conversations.get(lead.id) ?? emptyConversation(), bookings.get(digitsOf(lead.phone))),
    );
  }

  return { rows: mergeRepeatEnquiries(rows), testRowsExcluded };
}

/**
 * The conversation itself, presented where the other practices show their AI's
 * Boxly notes. Dental Aesthetica writes no such note: what Poppy said and what
 * the patient said back is the record, and we already hold it.
 */
export async function getDentalAestheticaNotes(leadId: string): Promise<FunnelNote[]> {
  const supabase = supabaseAdmin();
  if (!supabase) throw new Error("storage_unavailable");

  const { data, error } = await supabase
    .from("messages")
    .select("id, direction, body, ai_generated, created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(`conversation_lookup_failed:${error.message}`);

  return (data ?? []).map((message, index) => ({
    id: String(message.id ?? `${leadId}-${index}`),
    title: message.direction === "outbound" ? (message.ai_generated ? "Poppy" : "Practice") : "Patient",
    description: typeof message.body === "string" ? message.body : "",
    createdAt: typeof message.created_at === "string" ? message.created_at : null,
    createdBy: message.direction === "outbound" ? "WhatsApp agent" : null,
  }));
}

async function fetchLeads(practiceId: string): Promise<LeadRow[]> {
  const supabase = supabaseAdmin();
  if (!supabase) throw new Error("storage_unavailable");

  const all: LeadRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("leads")
      .select("id, name, phone, email, source, external_payload, updated_at")
      .eq("practice_id", practiceId)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`lead_lookup_failed:${error.message}`);
    const page = (data ?? []) as LeadRow[];
    all.push(...page);
    if (page.length < PAGE_SIZE) return all;
  }
}

async function fetchConversations(practiceId: string): Promise<Map<string, Conversation>> {
  const supabase = supabaseAdmin();
  if (!supabase) throw new Error("storage_unavailable");

  const byLead = new Map<string, Conversation>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("messages")
      .select("lead_id, direction, created_at")
      .eq("practice_id", practiceId)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`message_lookup_failed:${error.message}`);

    const page = (data ?? []) as MessageRow[];
    for (const message of page) {
      if (!message.lead_id) continue;
      const current = byLead.get(message.lead_id) ?? emptyConversation();
      const at = message.created_at;
      if (message.direction === "outbound") {
        current.outbound += 1;
        if (at && (!current.firstOutboundAt || at < current.firstOutboundAt)) current.firstOutboundAt = at;
      } else if (message.direction === "inbound") {
        current.inbound += 1;
      }
      if (at && (!current.lastAt || at > current.lastAt)) current.lastAt = at;
      byLead.set(message.lead_id, current);
    }

    if (page.length < PAGE_SIZE) return byLead;
  }
}

/** Bookings keyed by phone digits, which is what the workflow stores them against. */
async function fetchBookings(practiceId: string): Promise<Map<string, BookingRow>> {
  const access = await loadBookingSourceAccess(practiceId);
  if (!access) return new Map();

  const bookings = createClient(access.url, access.key, { auth: { persistSession: false } });
  const { data, error } = await bookings
    .from(access.table)
    .select(
      "number, dentally_appointment_id, dentally_patient_id, deposit_status, deposit_amount, deposit_paid_at, chosen_start_time, booking_error",
    );
  if (error) throw new Error(`booking_lookup_failed:${error.code ?? error.message}`);

  const byNumber = new Map<string, BookingRow>();
  for (const row of (data ?? []) as BookingRow[]) {
    const digits = digitsOf(row.number);
    if (!digits) continue;
    // A patient who books again gets a fresh row; keep whichever proves the most.
    const current = byNumber.get(digits);
    if (!current || bookingRank(row) > bookingRank(current)) byNumber.set(digits, row);
  }
  return byNumber;
}

function bookingRank(row: BookingRow): number {
  if (row.dentally_appointment_id) return 3;
  if (row.deposit_paid_at) return 2;
  if (row.chosen_start_time) return 1;
  return 0;
}

function toFunnelRow(lead: LeadRow, conversation: Conversation, booking: BookingRow | undefined): FunnelLeadRow {
  const legacy = lead.external_payload?.legacy ?? {};
  const appointmentId = booking?.dentally_appointment_id ? String(booking.dentally_appointment_id) : null;
  const depositPaidAt = booking?.deposit_paid_at ?? null;
  const depositRevenue = depositPaidAt ? moneyValue(booking?.deposit_amount) : 0;
  const consultBooked = Boolean(appointmentId);
  const reached = conversation.outbound > 0 || text(legacy.outboundStatus) === "sent";
  const aiActionedAt = conversation.firstOutboundAt ?? isoOrNull(legacy.outboundSentAt);

  return {
    id: `${PRACTICE_KEY}:${lead.id}`,
    practice: PRACTICE_KEY,
    practiceLabel: PRACTICE_LABEL,
    boxlyLeadId: lead.id,
    patientName: lead.name?.trim() || "Unknown",
    phone: lead.phone ?? null,
    email: lead.email ?? null,
    leadSource: text(lead.source) || "Unknown",
    boxName: text(legacy.treatmentType) || null,
    boxStage: text(legacy.stage) || null,
    leadSummary: null,
    aiActioned: reached,
    clientReplied: conversation.inbound > 0,
    conversationCount: conversation.outbound + conversation.inbound,
    becameLeadAt: isoOrNull(legacy.enquiredAt) ?? isoOrNull(legacy.becameLeadAt) ?? isoOrNull(legacy.firstSeenAt),
    actionedAt: isoOrNull(legacy.actionedAt),
    aiActionedAt,
    lastUpdatedAt: conversation.lastAt ?? isoOrNull(legacy.lastUpdatedAt) ?? lead.updated_at,
    actionedNote: null,
    consultBooked,
    // No per-consult value: this practice charges no consultation fee.
    consultBookingValue: DENTAL_AESTHETICA_CONSULT_VALUE,
    bookedUsingSystem: consultBooked,
    attributionConfidence: confidenceOf(appointmentId, depositPaidAt, booking),
    attributionReason: reasonOf(appointmentId, depositPaidAt, booking),
    // The deposit is the only money this practice takes before treatment, and
    // it is refundable. Reported as a deposit so it is never read as earned.
    attributedPaymentRevenue: depositRevenue,
    consultDepositRevenue: depositRevenue,
    monthlyPlanRevenue: 0,
    otherPaidRevenue: 0,
    hardPaidRevenue: 0,
    estimatedTreatmentOpportunity: 0,
    treatmentEvidence: false,
    treatmentEvidenceReason: null,
    // A slot the patient never paid for is not an appointment, so the consult
    // date is only claimed once Dentally holds the booking.
    dentallyConsultAt: consultBooked ? (booking?.chosen_start_time ?? null) : null,
    dentallyTreatmentAt: null,
    dentallyPaidAt: depositPaidAt,
    commercialSequence: sequenceOf(reached, conversation.inbound > 0, depositPaidAt, appointmentId),
    dentallyPatientId: booking?.dentally_patient_id ? String(booking.dentally_patient_id) : null,
    dentallyStatus: "not_enriched",
  };
}

function confidenceOf(
  appointmentId: string | null,
  depositPaidAt: string | null,
  booking: BookingRow | undefined,
): AttributionConfidence {
  if (appointmentId) return "high";
  if (depositPaidAt) return "medium";
  if (booking?.chosen_start_time) return "low";
  return "none";
}

function reasonOf(
  appointmentId: string | null,
  depositPaidAt: string | null,
  booking: BookingRow | undefined,
): string {
  if (appointmentId) {
    return `Dentally appointment ${appointmentId} created by the WhatsApp agent after the deposit was paid`;
  }
  if (depositPaidAt) {
    const failure = text(booking?.booking_error);
    return failure
      ? `Deposit paid but the Dentally booking failed: ${failure}`
      : "Deposit paid but no Dentally appointment recorded";
  }
  if (booking?.chosen_start_time) return "Slot chosen and deposit link sent; deposit not paid";
  return "No deposit or booking on record";
}

function sequenceOf(
  reached: boolean,
  replied: boolean,
  depositPaidAt: string | null,
  appointmentId: string | null,
): string {
  if (!reached) return "Not yet messaged";
  const steps = ["WhatsApp opener sent"];
  if (replied) steps.push("patient replied");
  if (depositPaidAt) steps.push("deposit paid");
  if (appointmentId) steps.push("Dentally appointment created");
  else if (depositPaidAt) steps.push("no appointment recorded");
  return steps.join(" → ");
}

/**
 * One row per patient.
 *
 * A patient who enquires twice is two leads in the feeder but one person in a
 * funnel, and counting them twice would overstate both bookings and deposits.
 * Identity is the phone number first, since that is what the workflow books and
 * charges against.
 */
function mergeRepeatEnquiries(rows: FunnelLeadRow[]): FunnelLeadRow[] {
  const byPatient = new Map<string, { row: FunnelLeadRow; enquiries: number }>();

  for (const row of rows) {
    const key = identityOf(row);
    const current = byPatient.get(key);
    if (!current) {
      byPatient.set(key, { row, enquiries: 1 });
      continue;
    }

    const kept = bookingWeight(row) > bookingWeight(current.row) ? row : current.row;
    const other = kept === row ? current.row : row;
    byPatient.set(key, {
      enquiries: current.enquiries + 1,
      row: {
        ...kept,
        aiActioned: kept.aiActioned || other.aiActioned,
        clientReplied: kept.clientReplied || other.clientReplied,
        conversationCount: kept.conversationCount + other.conversationCount,
        becameLeadAt: earlier(kept.becameLeadAt, other.becameLeadAt),
        aiActionedAt: earlier(kept.aiActionedAt, other.aiActionedAt),
        lastUpdatedAt: later(kept.lastUpdatedAt, other.lastUpdatedAt),
      },
    });
  }

  return [...byPatient.values()].map(({ row, enquiries }) =>
    enquiries > 1 ? { ...row, leadSummary: `${enquiries} enquiries from this patient` } : row,
  );
}

function earlier(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function later(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function identityOf(row: FunnelLeadRow): string {
  const phone = digitsOf(row.phone);
  if (phone) return `phone:${phone}`;
  if (row.email) return `email:${row.email.trim().toLowerCase()}`;
  return `name:${row.patientName.toLowerCase()}`;
}

function bookingWeight(row: FunnelLeadRow): number {
  if (row.consultBooked) return 3;
  if (row.consultDepositRevenue > 0) return 2;
  if (row.clientReplied) return 1;
  return 0;
}

function isTestLead(lead: LeadRow): boolean {
  return lead.external_payload?.legacy?.isTestName === true;
}

function emptyConversation(): Conversation {
  return { outbound: 0, inbound: 0, firstOutboundAt: null, lastAt: null };
}

/** Last ten digits, so a stored 0771 and a stored +44771 are the same patient. */
function digitsOf(value: string | number | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isoOrNull(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function moneyValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

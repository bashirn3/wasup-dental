"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AccountMenu from "@/components/auth/AccountMenu";

type PracticeKey = "regent" | "nuyu" | "dental_aesthetica";
type StatusFilter = "all" | "replied" | "booked" | "treatment" | "paid";
type DonutDisplayMode = "number" | "percent";

type FunnelLeadRow = {
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
  attributedPaymentRevenue: number;
  consultDepositRevenue: number;
  monthlyPlanRevenue: number;
  otherPaidRevenue: number;
  bookedUsingSystem: boolean;
  attributionConfidence: "high" | "medium" | "low" | "none";
  attributionReason: string;
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

type FunnelPracticeSummary = {
  key: PracticeKey;
  label: string;
  v1ActivityUrl: string;
  /** What a consultation costs the patient here. Zero where it is free. */
  consultValue: number;
  /** Our own test leads, excluded from every figure on this practice. */
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

type FunnelData = {
  ok: boolean;
  generatedAt: string;
  cache: { status: "fresh" | "stale"; ageMs: number; ttlMs: number };
  dentally: {
    status: "not_enriched" | "partial" | "enriched" | "error";
    message: string;
    enrichedRows?: number;
    attemptedRows?: number;
  };
  practices: FunnelPracticeSummary[];
  /** Practices whose source could not be read on the last build. */
  warnings?: string[];
};

type FunnelNote = {
  id: string;
  title: string;
  description: string;
  createdAt: string | null;
  createdBy: string | null;
};

const statusOptions: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "replied", label: "Replied" },
  { value: "booked", label: "Booked" },
  { value: "treatment", label: "Treatment" },
  { value: "paid", label: "Paid" },
];

export default function SalesFunnelDashboard() {
  const [data, setData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [practiceKey, setPracticeKey] = useState<PracticeKey>("regent");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedLead, setSelectedLead] = useState<FunnelLeadRow | null>(null);
  const [notes, setNotes] = useState<Record<string, FunnelNote[]>>({});
  const [notesLoading, setNotesLoading] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      const res = await fetch("/api/admin/funnel", { cache: "no-store" });
      const payload = (await res.json()) as FunnelData & { error?: string };
      if (!res.ok) throw new Error(payload.error || "Failed to load funnel");
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activePractice = useMemo(
    () => data?.practices.find((practice) => practice.key === practiceKey) ?? data?.practices[0] ?? null,
    [data, practiceKey],
  );

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (activePractice?.rows ?? []).filter((row) => {
      if (status === "replied" && !row.clientReplied) return false;
      if (status === "booked" && !row.consultBooked) return false;
      if (status === "treatment" && !row.treatmentEvidence && row.estimatedTreatmentOpportunity <= 0 && row.hardPaidRevenue <= 0) {
        return false;
      }
      if (status === "paid" && row.hardPaidRevenue <= 0) return false;
      if (!needle) return true;
      return [row.patientName, row.phone, row.email, row.leadSource, row.boxName, row.boxStage]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [activePractice?.rows, query, status]);

  useEffect(() => {
    setPage(1);
  }, [practiceKey, query, status, pageSize]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize);

  async function openLead(row: FunnelLeadRow) {
    setSelectedLead(row);
    if (notes[row.id]) return;
    setNotesLoading(row.id);
    try {
      const params = new URLSearchParams({ practice: row.practice, leadId: row.boxlyLeadId });
      const res = await fetch(`/api/admin/funnel/notes?${params.toString()}`, { cache: "no-store" });
      const payload = (await res.json()) as { notes?: FunnelNote[] };
      setNotes((current) => ({ ...current, [row.id]: payload.notes ?? [] }));
    } catch {
      setNotes((current) => ({ ...current, [row.id]: [] }));
    } finally {
      setNotesLoading("");
    }
  }

  return (
    <main className="min-h-dvh bg-[#f4f2ea] text-[#1d211b]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 overflow-hidden px-4 py-4 sm:px-6 lg:px-8">
        <header className="sticky top-0 z-20 -mx-4 border-b border-black/5 bg-[#f4f2ea]/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#5f6f61]">Admin only</p>
              <h1 className="truncate text-2xl font-black tracking-[-0.04em] sm:text-4xl">Attribution funnel</h1>
            </div>
            <Link
              href="/dashboard"
              className="hidden rounded-full bg-white px-4 py-2 text-sm font-bold shadow-sm ring-1 ring-black/5 sm:inline-flex"
            >
              Dashboard
            </Link>
            <AccountMenu />
          </div>
        </header>

        {loading ? (
          <LoadingState />
        ) : error ? (
          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
            <p className="font-bold text-red-700">Could not load funnel</p>
            <p className="mt-1 text-sm text-[#637064]">{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-4 rounded-full bg-[#0b3020] px-4 py-2 text-sm font-bold text-white"
            >
              Try again
            </button>
          </div>
        ) : !activePractice ? (
          <section className="rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-black/5">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[#8a6f4d]">Attribution funnel</p>
            <h2 className="mt-3 text-2xl font-black tracking-[-0.04em]">Attribution data is preparing</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#637064]">
              Generate the latest attribution data first, then this dashboard will show the commercial funnel.
            </p>
            {data?.dentally.message && <p className="mt-3 text-sm font-bold text-[#8a6f4d]">{data.dentally.message}</p>}
          </section>
        ) : (
          <>
            <section className="rounded-[2rem] bg-[#0b3020] p-4 text-white shadow-xl shadow-[#0b3020]/15 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="inline-flex rounded-full bg-white/10 p-1">
                    {data?.practices.map((practice) => (
                      <button
                        key={practice.key}
                        type="button"
                        onClick={() => setPracticeKey(practice.key)}
                        className={`rounded-full px-4 py-2 text-sm font-bold transition ${
                          practice.key === activePractice.key ? "bg-[#c8ee4e] text-[#0b3020]" : "text-white/75"
                        }`}
                      >
                        {practice.label.replace(" Dental", "")}
                      </button>
                    ))}
                  </div>
                  <h2 className="mt-4 text-3xl font-black tracking-[-0.04em]">{activePractice.label}</h2>
                  <p className="mt-1 text-sm text-white/65">
                    Snapshot {formatDateTime(data?.generatedAt)} · cache {data?.cache.status}
                    {activePractice.testRowsExcluded > 0 &&
                      ` · ${activePractice.testRowsExcluded} of our own test leads excluded`}
                  </p>
                  {(data?.warnings ?? []).map((warning) => (
                    <p key={warning} className="mt-1 text-sm font-bold text-[#f6c250]">
                      {warning}
                    </p>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href="/api/admin/funnel?format=csv"
                    className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white"
                  >
                    Export CSV
                  </a>
                </div>
              </div>
            </section>

            <CommercialFunnelHero practice={activePractice} dentallyPending={data?.dentally.status === "not_enriched"} />

            <AttributionInsights practice={activePractice} dentallyPending={data?.dentally.status === "not_enriched"} />

            <SourceCard practice={activePractice} />

            <section className="overflow-hidden rounded-[2rem] bg-white p-4 shadow-sm ring-1 ring-black/5 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-lg font-black tracking-[-0.03em]">Lead evidence</h3>
                  <p className="text-sm text-[#637064]">{rows.length} visible leads in this attribution set.</p>
                </div>
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search name, phone, source..."
                    className="h-11 w-full min-w-0 rounded-2xl border border-black/10 bg-[#f8f7f1] px-4 text-sm outline-none focus:border-[#0b3020] sm:w-64"
                  />
                  <div className="flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-[#f8f7f1] p-1">
                    {statusOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setStatus(option.value)}
                        className={`shrink-0 rounded-xl px-3 py-2 text-xs font-bold ${
                          status === option.value ? "bg-[#0b3020] text-white" : "text-[#637064]"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <select
                    value={pageSize}
                    onChange={(event) => setPageSize(Number(event.target.value))}
                    className="h-11 w-full rounded-2xl border border-black/10 bg-[#f8f7f1] px-3 text-sm font-bold outline-none focus:border-[#0b3020] sm:w-auto"
                  >
                    {[20, 50, 100].map((value) => (
                      <option key={value} value={value}>
                        {value} / page
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-4 grid gap-3">
                {pagedRows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => void openLead(row)}
                    className="w-full max-w-full overflow-hidden rounded-3xl bg-[#f8f7f1] p-4 text-left transition hover:bg-[#f0eedf]"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-sm font-black text-[#0b3020] shadow-sm">
                        {initials(row.patientName)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-base font-black">{row.patientName}</p>
                          {row.consultBooked && <Badge tone="green">Booked</Badge>}
                          {row.treatmentEvidence && <Badge tone="amber">Treatment</Badge>}
                          {row.attributedPaymentRevenue > 0 && <Badge tone="green">Paid row</Badge>}
                          {row.hardPaidRevenue > 0 && <Badge tone="green">Paid</Badge>}
                          {row.clientReplied && <Badge tone="blue">Replied</Badge>}
                          {row.attributionConfidence !== "none" && <Badge tone="amber">{row.attributionConfidence}</Badge>}
                        </div>
                        <p className="mt-1 truncate text-sm text-[#637064]">
                          {row.leadSource} · {row.boxName ?? "Box"} · {row.boxStage ?? "Stage unknown"}
                        </p>
                        <p className="mt-2 text-xs text-[#637064]">
                          {row.conversationCount} msgs · AI {formatDateTime(row.aiActionedAt)}
                        </p>
                      </div>
                      <div className="hidden shrink-0 text-right sm:block">
                        <p className="text-sm font-black">{row.consultBooked ? "£65" : "—"}</p>
                        <p className="text-[11px] text-[#637064]">consult</p>
                        {row.estimatedTreatmentOpportunity > 0 && (
                          <p className="mt-1 text-[11px] font-bold text-[#92400e]">
                            {money(row.estimatedTreatmentOpportunity)} plan value
                          </p>
                        )}
                        {row.hardPaidRevenue > 0 && (
                          <p className="mt-1 text-[11px] font-bold text-[#166534]">{money(row.hardPaidRevenue)} paid</p>
                        )}
                        {row.attributedPaymentRevenue > 0 && row.hardPaidRevenue <= 0 && (
                          <p className="mt-1 text-[11px] font-bold text-[#166534]">
                            {money(row.attributedPaymentRevenue)} payment
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
                {status === "paid" && data?.dentally.status === "not_enriched" ? (
                  <p className="rounded-2xl bg-[#f8f7f1] p-4 text-sm text-[#637064]">
                    Payment data is preparing.
                  </p>
                ) : null}
                <div className="flex flex-col gap-3 rounded-3xl bg-[#f8f7f1] p-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm font-bold text-[#637064]">
                    Showing {rows.length === 0 ? 0 : (safePage - 1) * pageSize + 1}–
                    {Math.min(safePage * pageSize, rows.length)} of {rows.length}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={safePage <= 1}
                      onClick={() => setPage((current) => Math.max(1, current - 1))}
                      className="rounded-full bg-white px-4 py-2 text-sm font-black text-[#0b3020] shadow-sm disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <span className="text-sm font-black text-[#637064]">
                      Page {safePage} / {totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={safePage >= totalPages}
                      onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                      className="rounded-full bg-white px-4 py-2 text-sm font-black text-[#0b3020] shadow-sm disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}
      </div>

      {selectedLead && (
        <LeadDrawer
          lead={selectedLead}
          notes={notes[selectedLead.id]}
          loading={notesLoading === selectedLead.id}
          onClose={() => setSelectedLead(null)}
        />
      )}
    </main>
  );
}

type SourceTotals = {
  source: string;
  leads: number;
  replied: number;
  booked: number;
  treatment: number;
  paid: number;
  payments: number;
  messages: number;
};

type FunnelSegment = {
  source: string;
  value: number;
  color: string;
};

type CommercialFunnelStage = {
  key: string;
  label: string;
  count: number;
  value: string;
  helper: string;
  width: number;
  segments: FunnelSegment[];
};

const STAFF_MINUTES_SAVED_PER_REPLY = 15;
const STAFF_HOURLY_COST = 20;
const PROJECTED_TREATMENT_VALUE = 2300;

const SOURCE_COLORS: Record<string, string> = {
  "Facebook Lead Ads": "#0b3020",
  "Direct Traffic": "#10907f",
  "Google Paid Search": "#c8ee4e",
  Manual: "#f59e0b",
  WhatsApp: "#2563eb",
  Instagram: "#ec4899",
  "Referred by a dentist": "#8b5cf6",
  Unknown: "#64748b",
};

const SOURCE_DONUT_COLORS = ["#0b3020", "#0f5f55", "#10907f", "#46b887", "#88d66c", "#c8ee4e", "#e7f8bd"];

function CommercialFunnelHero({ practice, dentallyPending }: { practice: FunnelPracticeSummary; dentallyPending: boolean }) {
  const sourceTotals = sourceTotalsFromRows(practice.rows);
  const staffTimeSaving = (practice.patientsReplied * STAFF_MINUTES_SAVED_PER_REPLY * STAFF_HOURLY_COST) / 60;
  const totalOperationalSaving = practice.metaApiCostSavings + staffTimeSaving;
  const paymentBreakdown = dentallyPending
    ? "Payment data preparing"
    : `${money(practice.hardPaidTreatmentRevenue)} full/cash · ${money(practice.monthlyPlanRevenue)} plans · ${money(
        practice.consultDepositRevenue + practice.otherPaidRevenue,
      )} deposits/partial`;
  const paidPatientCount = sourceTotals.reduce((sum, item) => sum + item.paid, 0);
  const treatmentCount = sourceTotals.reduce((sum, item) => sum + item.treatment, 0);
  const chargesForConsults = practice.consultValue > 0;

  const stages: CommercialFunnelStage[] = [
    {
      key: "leads",
      label: "Leads reached",
      count: practice.leadsReached,
      value: `${percent(practice.leadsReached, practice.leadsReached)} start`,
      helper: `Top source: ${sourceTotals[0]?.source ?? "Unknown"}`,
      width: 100,
      segments: sourceSegments(sourceTotals, "leads"),
    },
    {
      key: "replied",
      label: "AI conversations",
      count: practice.patientsReplied,
      value: money(totalOperationalSaving),
      helper: `${money(practice.metaApiCostSavings)} messaging/API · ${money(staffTimeSaving)} staff time saved`,
      width: 88,
      segments: sourceSegments(sourceTotals, "replied"),
    },
    {
      key: "booked",
      label: "Consults booked",
      count: practice.consultsBooked,
      // A practice that charges nothing for a consultation gets a count and the
      // deposits it actually holds, not a fee it never asked for.
      value: chargesForConsults
        ? money(practice.consultBookingValue)
        : practice.consultDepositRevenue > 0
          ? `${money(practice.consultDepositRevenue)} held`
          : `${practice.consultsBooked} booked`,
      helper: chargesForConsults
        ? `${practice.consultsBooked} × ${money(practice.consultValue)} consult value`
        : "No consultation fee here; deposits are refundable",
      width: 76,
      segments: sourceSegments(sourceTotals, "booked"),
    },
    {
      key: "treatment",
      label: "Treatment progression",
      count: treatmentCount,
      value: `${percent(treatmentCount, practice.consultsBooked)} of consults`,
      helper: "Treatment plans, treatment appointments, and paid rows",
      width: 64,
      segments: sourceSegments(sourceTotals, "treatment"),
    },
    {
      key: "paid",
      label: "Matched payments",
      count: paidPatientCount,
      value: dentallyPending ? "Pending" : money(practice.attributedPaymentRevenue),
      helper: paymentBreakdown,
      width: 52,
      segments: sourceSegments(sourceTotals, "paid"),
    },
  ];

  return (
    <section className="overflow-hidden rounded-[2rem] bg-white p-5 shadow-sm ring-1 ring-black/5 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#637064]">Client value funnel</p>
          <h3 className="mt-1 text-2xl font-black tracking-[-0.04em] sm:text-3xl">From lead source to matched payments</h3>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#637064]">
            A five-stage view of how AI-engaged leads turned into conversations, consult value, treatment progression, and Dentally payments.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <MiniFact label="Operational saving" value={money(totalOperationalSaving)} />
          {chargesForConsults ? (
            <MiniFact label="Consult value" value={money(practice.consultBookingValue)} />
          ) : (
            <MiniFact label="Deposits held" value={money(practice.consultDepositRevenue)} />
          )}
          <MiniFact label="Matched payments" value={dentallyPending ? "Pending" : money(practice.attributedPaymentRevenue)} />
        </div>
      </div>

      <div className="mt-5 hidden overflow-x-auto pb-2 lg:block">
        <DesktopFunnelSvg stages={stages} />
      </div>

      <div className="mt-4 hidden grid-cols-5 gap-3 lg:grid">
        {stages.map((stage) => (
          <div key={stage.key} className="rounded-3xl bg-[#f8f7f1] p-4">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-[#637064]">{stage.label}</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#49574b]">{stage.helper}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 lg:hidden">
        <MobileFunnelSvg stages={stages} />
        <div className="mt-3 grid gap-2">
          {stages.map((stage, index) => (
            <div key={stage.key} className="rounded-2xl bg-[#f8f7f1] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#637064]">Stage {index + 1}</p>
                  <p className="mt-1 text-sm font-black">{stage.label}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-lg font-black text-[#0b3020]">{numberFmt(stage.count)}</p>
                  <p className="text-xs font-black text-[#637064]">{stage.value}</p>
                </div>
              </div>
              <p className="mt-1 text-xs font-semibold leading-5 text-[#637064]">{stage.helper}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DesktopFunnelSvg({ stages }: { stages: CommercialFunnelStage[] }) {
  const geometry = horizontalFunnelGeometry(stages);
  const funnelTip = horizontalFunnelTip(geometry.at(-1));
  const stageColors = ["#0b3020", "#0f5f55", "#10907f", "#16a6a8", "#0b7285"];

  return (
    <div className="min-w-[1120px] rounded-[2rem] bg-[#f8f7f1] p-5">
      <svg viewBox="0 0 1180 420" className="h-[420px] w-full" role="img" aria-label="Commercial attribution funnel">
        <defs>
          <filter id="funnelShadow" x="-10%" y="-10%" width="120%" height="130%">
            <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#0b3020" floodOpacity="0.12" />
          </filter>
          <linearGradient id="funnelBaseGlow" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#0b3020" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#0b3020" stopOpacity="0.04" />
          </linearGradient>
        </defs>

        <path
          d={`M ${geometry[0].x0} ${geometry[0].top0} L ${funnelTip.tipX} ${funnelTip.midY} L ${geometry[0].x0} ${geometry[0].bottom0} Z`}
          fill="url(#funnelBaseGlow)"
        />

        {geometry.map((shape, index) => {
          const stage = stages[index];
          const points = `${shape.x0},${shape.top0} ${shape.x1},${shape.top1} ${shape.x1},${shape.bottom1} ${shape.x0},${shape.bottom0}`;
          const labelX = (shape.x0 + shape.x1) / 2;
          const labelWidth = Math.max(138, Math.min(208, shape.x1 - shape.x0 - 16));
          const labelY = 18;
          const labelHeight = 112;
          const labelBoxX = labelX - labelWidth / 2;
          const connectorStartY = labelY + labelHeight + 8;
          const connectorEndY = Math.min(shape.top0, shape.top1) - 8;
          const labelLines = splitStageLabel(stage.label);
          return (
            <g key={stage.key}>
              <polygon points={points} fill={stageColors[index] ?? "#0b3020"} stroke="#f8f7f1" strokeWidth="5" filter="url(#funnelShadow)" />
              <line x1={labelX} y1={connectorStartY} x2={labelX} y2={connectorEndY} stroke="#0b3020" strokeOpacity="0.16" strokeWidth="2" />
              <rect x={labelBoxX} y={labelY} width={labelWidth} height={labelHeight} rx="20" fill="#ffffff" filter="url(#funnelShadow)" />
              <text x={labelX} y={labelY + 19} textAnchor="middle" fill="#637064" fontSize="10" fontWeight="900" letterSpacing="2.4">
                STAGE {index + 1}
              </text>
              <text x={labelX} y={labelY + 42} textAnchor="middle" fill="#1d211b" fontSize="15" fontWeight="900">
                {labelLines.map((line, lineIndex) => (
                  <tspan key={line} x={labelX} dy={lineIndex === 0 ? 0 : 18}>
                    {line}
                  </tspan>
                ))}
              </text>
              <text x={labelX} y={labelY + 83} textAnchor="middle" fill="#0b3020" fontSize="22" fontWeight="900">
                {numberFmt(stage.count)}
              </text>
              <text x={labelX} y={labelY + 104} textAnchor="middle" fill="#637064" fontSize="12" fontWeight="900">
                {stage.value}
              </text>
            </g>
          );
        })}
        <polygon
          points={`${funnelTip.baseX},${funnelTip.topY} ${funnelTip.tipX},${funnelTip.midY} ${funnelTip.baseX},${funnelTip.bottomY}`}
          fill={stageColors.at(-1) ?? "#0b3020"}
          opacity="0.95"
          stroke="#f8f7f1"
          strokeWidth="5"
          filter="url(#funnelShadow)"
        />
      </svg>
    </div>
  );
}

function MobileFunnelSvg({ stages }: { stages: CommercialFunnelStage[] }) {
  const geometry = verticalFunnelGeometry(stages);
  const stageColors = ["#0b3020", "#0f5f55", "#10907f", "#16a6a8", "#0b7285"];

  return (
    <div className="overflow-hidden rounded-[2rem] bg-[#f8f7f1] p-3">
      <svg viewBox="0 0 360 640" className="h-auto w-full" role="img" aria-label="Mobile commercial attribution funnel">
        <defs>
          <filter id="mobileFunnelShadow" x="-10%" y="-10%" width="120%" height="130%">
            <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#0b3020" floodOpacity="0.12" />
          </filter>
        </defs>

        {geometry.map((shape, index) => {
          const stage = stages[index];
          const points = `${shape.leftTop},${shape.y0} ${shape.rightTop},${shape.y0} ${shape.rightBottom},${shape.y1} ${shape.leftBottom},${shape.y1}`;
          const badgeY = shape.y0 + (shape.y1 - shape.y0) / 2 + 7;
          return (
            <g key={stage.key} filter="url(#mobileFunnelShadow)">
              <polygon points={points} fill={stageColors[index] ?? "#0b3020"} stroke="#f8f7f1" strokeWidth="5" />
              <circle cx="180" cy={badgeY - 7} r="18" fill="rgba(255,255,255,0.92)" />
              <text x="180" y={badgeY} textAnchor="middle" fill="#0b3020" fontSize="14" fontWeight="900">
                {index + 1}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function verticalFunnelGeometry(stages: CommercialFunnelStage[]) {
  const centerX = 180;
  const startWidth = 316;
  const minWidth = 82;
  const startY = 34;
  const endY = 604;
  const firstCount = Math.max(stages[0]?.count ?? 1, 1);
  const stageHeight = (endY - startY) / stages.length;
  const widthFor = (count: number) => Math.max(minWidth, startWidth * Math.sqrt(Math.max(count, 0) / firstCount));

  return stages.map((stage, index) => {
    const nextStage = stages[index + 1] ?? stage;
    const y0 = startY + index * stageHeight;
    const y1 = index === stages.length - 1 ? endY : startY + (index + 1) * stageHeight;
    const topWidth = widthFor(stage.count);
    const bottomWidth = index === stages.length - 1 ? minWidth : widthFor(nextStage.count);
    return {
      y0,
      y1,
      leftTop: centerX - topWidth / 2,
      rightTop: centerX + topWidth / 2,
      leftBottom: centerX - bottomWidth / 2,
      rightBottom: centerX + bottomWidth / 2,
    };
  });
}

function horizontalFunnelGeometry(stages: CommercialFunnelStage[]) {
  const startX = 28;
  const endX = 1068;
  const midY = 268;
  const startHalfHeight = 112;
  const minHalfHeight = 28;
  const firstCount = Math.max(stages[0]?.count ?? 1, 1);
  const stageWidth = (endX - startX) / stages.length;
  const halfHeightFor = (count: number) => Math.max(minHalfHeight, startHalfHeight * Math.sqrt(Math.max(count, 0) / firstCount));

  return stages.map((stage, index) => {
    const x0 = startX + index * stageWidth;
    const x1 = index === stages.length - 1 ? endX : startX + (index + 1) * stageWidth;
    const nextStage = stages[index + 1] ?? stage;
    const half0 = halfHeightFor(stage.count);
    const half1 = halfHeightFor(nextStage.count);
    return {
      x0,
      x1,
      top0: midY - half0,
      top1: midY - half1,
      bottom1: midY + half1,
      bottom0: midY + half0,
    };
  });
}

function horizontalFunnelTip(lastShape?: ReturnType<typeof horizontalFunnelGeometry>[number]) {
  const midY = 268;
  const baseX = lastShape?.x1 ?? 1068;
  const topY = lastShape?.top1 ?? 226;
  const bottomY = lastShape?.bottom1 ?? 310;
  return {
    baseX,
    tipX: 1144,
    midY,
    topY,
    bottomY,
  };
}

function splitStageLabel(label: string) {
  if (label.length <= 16) return [label];
  const parts = label.split(" ");
  const midpoint = Math.ceil(parts.length / 2);
  return [parts.slice(0, midpoint).join(" "), parts.slice(midpoint).join(" ")];
}

function sourceSegments(totals: SourceTotals[], key: keyof Pick<SourceTotals, "leads" | "replied" | "booked" | "treatment" | "paid">) {
  return totals
    .map((source, index) => ({
      source: source.source,
      value: source[key],
      color: sourceColor(source.source, index),
    }))
    .filter((segment) => segment.value > 0);
}

function sourceTotalsFromRows(rows: FunnelLeadRow[]): SourceTotals[] {
  const bySource = new Map<string, SourceTotals>();
  const treatmentByPatient = new Map<string, FunnelLeadRow>();
  const paidByPatient = new Map<string, FunnelLeadRow>();

  for (const row of rows) {
    const source = displaySource(row.leadSource);
    const item = bySource.get(source) ?? {
      source,
      leads: 0,
      replied: 0,
      booked: 0,
      treatment: 0,
      paid: 0,
      payments: 0,
      messages: 0,
    };

    if (row.aiActioned) item.leads += 1;
    if (row.clientReplied) item.replied += 1;
    if (row.consultBooked) item.booked += 1;
    item.messages += row.conversationCount;
    bySource.set(source, item);

    const patientKey = commercialPatientKey(row);
    if (row.treatmentEvidence && !treatmentByPatient.has(patientKey)) treatmentByPatient.set(patientKey, row);
    if (row.attributedPaymentRevenue > 0) {
      const current = paidByPatient.get(patientKey);
      if (!current || row.attributedPaymentRevenue > current.attributedPaymentRevenue) paidByPatient.set(patientKey, row);
    }
  }

  for (const row of treatmentByPatient.values()) {
    const source = displaySource(row.leadSource);
    const item = bySource.get(source);
    if (item) item.treatment += 1;
  }

  for (const row of paidByPatient.values()) {
    const source = displaySource(row.leadSource);
    const item = bySource.get(source);
    if (item) {
      item.paid += 1;
      item.payments += row.attributedPaymentRevenue;
    }
  }

  return [...bySource.values()].sort((a, b) => b.leads - a.leads);
}

function commercialPatientKey(row: FunnelLeadRow): string {
  if (row.dentallyPatientId) return `dentally:${row.dentallyPatientId}`;
  if (row.email) return `email:${row.email.trim().toLowerCase()}`;
  if (row.phone) return `phone:${row.phone.replace(/\D/g, "")}`;
  return `row:${row.id}`;
}

function sourceColor(source: string, index: number) {
  const palette = ["#0b3020", "#10907f", "#c8ee4e", "#f59e0b", "#2563eb", "#ec4899", "#8b5cf6", "#64748b"];
  return SOURCE_COLORS[source] ?? palette[index % palette.length];
}

function sourceDonutColor(index: number) {
  return SOURCE_DONUT_COLORS[Math.abs(index) % SOURCE_DONUT_COLORS.length];
}

function AttributionInsights({ practice, dentallyPending }: { practice: FunnelPracticeSummary; dentallyPending: boolean }) {
  const [mode, setMode] = useState<DonutDisplayMode>("number");
  const sources = sourceTotalsFromRows(practice.rows);
  const treatmentPatients = sources.reduce((sum, item) => sum + item.treatment, 0);
  const projectedTreatmentValue = treatmentPatients * PROJECTED_TREATMENT_VALUE;
  const collectedPayments = dentallyPending ? 0 : practice.attributedPaymentRevenue;
  const projectedBalance = Math.max(0, projectedTreatmentValue - collectedPayments);
  const replies = sources.filter((source) => source.replied > 0);
  const bookings = sources.filter((source) => source.booked > 0);
  const bestBookingRate = [...sources]
    .filter((source) => source.leads > 0 && source.booked > 0)
    .sort((a, b) => b.booked / b.leads - a.booked / a.leads)[0];
  const mostBookings = [...sources].sort((a, b) => b.booked - a.booked)[0];
  const mostPayments = [...sources].sort((a, b) => b.payments - a.payments)[0];

  return (
    <section className="grid items-start gap-4 xl:grid-cols-[1.05fr_0.95fr]">
      <div className="h-fit rounded-[2rem] bg-white p-5 shadow-sm ring-1 ring-black/5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#637064]">Treatment value</p>
            <h3 className="mt-1 text-xl font-black tracking-[-0.03em]">Collected vs projected</h3>
            <p className="mt-1 text-sm font-semibold leading-6 text-[#637064]">
              Projected value uses {money(PROJECTED_TREATMENT_VALUE)} per treatment-progressed patient.
            </p>
          </div>
          <div className="rounded-2xl bg-[#f8f7f1] px-4 py-3 text-right">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#637064]">Projected total</p>
            <p className="text-2xl font-black text-[#0b3020]">{money(projectedTreatmentValue)}</p>
          </div>
        </div>

        <div className="mt-5 grid gap-5 sm:grid-cols-[220px_1fr] sm:items-center">
          <DonutChart
            ariaLabel="Treatment value breakdown"
            centerLabel={money(projectedTreatmentValue)}
            centerSubLabel={`${treatmentPatients} patients`}
            segments={[
              { label: "Collected payments", value: collectedPayments, color: "#0b3020" },
              { label: "Projected remaining value", value: projectedBalance, color: "#c8ee4e" },
            ]}
          />
          <div className="grid gap-3">
            <InsightRow color="#0b3020" label="Collected payments" value={dentallyPending ? "Pending" : money(collectedPayments)} />
            <InsightRow color="#c8ee4e" label="Projected remaining treatment value" value={money(projectedBalance)} />
            <InsightRow color="#10907f" label="Treatment-progressed patients" value={numberFmt(treatmentPatients)} />
          </div>
        </div>
      </div>

      <div className="h-fit rounded-[2rem] bg-white p-5 shadow-sm ring-1 ring-black/5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#637064]">Source performance</p>
            <h3 className="mt-1 text-xl font-black tracking-[-0.03em]">Replies and bookings by channel</h3>
          </div>
          <div className="inline-flex rounded-full bg-[#f8f7f1] p-1">
            {(["number", "percent"] as DonutDisplayMode[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setMode(option)}
                className={`rounded-full px-3 py-2 text-xs font-black ${
                  mode === option ? "bg-[#0b3020] text-white" : "text-[#637064]"
                }`}
              >
                {option === "number" ? "Numbers" : "Percent"}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-4 2xl:grid-cols-2">
          <SourceDonut title="Replies" mode={mode} sources={replies} valueKey="replied" />
          <SourceDonut title="Bookings" mode={mode} sources={bookings} valueKey="booked" />
        </div>

        <div className="mt-5 grid gap-3">
          {bestBookingRate && (
            <ChannelInsight
              label="Best booking conversion"
              source={bestBookingRate.source}
              value={`${percent(bestBookingRate.booked, bestBookingRate.leads)} booked`}
              helper={`${bestBookingRate.booked}/${bestBookingRate.leads} leads converted`}
            />
          )}
          {mostBookings && (
            <ChannelInsight
              label="Most bookings"
              source={mostBookings.source}
              value={numberFmt(mostBookings.booked)}
              helper={`${percent(mostBookings.booked, mostBookings.leads)} booking conversion`}
            />
          )}
          {mostPayments && mostPayments.payments > 0 && (
            <ChannelInsight
              label="Most matched payments"
              source={mostPayments.source}
              value={money(mostPayments.payments)}
              helper={`${mostPayments.paid} paid patients attributed`}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function SourceDonut({
  title,
  mode,
  sources,
  valueKey,
}: {
  title: string;
  mode: DonutDisplayMode;
  sources: SourceTotals[];
  valueKey: "replied" | "booked";
}) {
  const [selectedLabel, setSelectedLabel] = useState(sources[0]?.source ?? "");
  const total = sources.reduce((sum, source) => sum + source[valueKey], 0);
  const selectedSource = sources.find((source) => source.source === selectedLabel) ?? sources[0] ?? null;
  const selectedValue = selectedSource ? selectedSource[valueKey] : 0;

  return (
    <div className="rounded-3xl bg-[#f8f7f1] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-black">{title}</p>
        <p className="text-sm font-black text-[#637064]">{numberFmt(total)} total</p>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-[132px_1fr] sm:items-center 2xl:grid-cols-1">
        <DonutChart
          ariaLabel={`${title} by source`}
          centerLabel={mode === "number" ? numberFmt(total) : "100%"}
          centerSubLabel={title.toLowerCase()}
          segments={sources.map((source, index) => ({
            label: source.source,
            value: source[valueKey],
            color: sourceDonutColor(index),
          }))}
          activeLabel={selectedSource?.source}
          onSegmentSelect={setSelectedLabel}
          size={132}
          strokeWidth={22}
        />
        <div className="min-w-0 rounded-2xl bg-white p-4 shadow-sm">
          {selectedSource ? (
            <>
              <div className="flex items-start gap-2">
                <span
                  className="mt-1 h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: sourceDonutColor(sources.findIndex((source) => source.source === selectedSource.source)) }}
                />
                <div className="min-w-0">
                  <p className="break-words text-sm font-black leading-5">{selectedSource.source}</p>
                  <p className="mt-1 text-xs font-semibold leading-5 text-[#637064]">
                    {numberFmt(selectedValue)} {title.toLowerCase()} · {percent(selectedValue, total)} of {title.toLowerCase()}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-[10px] font-black uppercase tracking-[0.14em] text-[#637064]">Tap chart segment to change source</p>
            </>
          ) : (
            <p className="text-sm font-bold text-[#637064]">No source data yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function DonutChart({
  segments,
  centerLabel,
  centerSubLabel,
  ariaLabel,
  activeLabel,
  onSegmentSelect,
  size = 210,
  strokeWidth = 30,
}: {
  segments: { label: string; value: number; color: string }[];
  centerLabel: string;
  centerSubLabel: string;
  ariaLabel: string;
  activeLabel?: string;
  onSegmentSelect?: (label: string) => void;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  const laidOutSegments = segments.reduce<{
    offset: number;
    items: Array<{ label: string; color: string; dash: number; offset: number }>;
  }>(
    (acc, segment) => {
      const dash = total > 0 ? (Math.max(0, segment.value) / total) * circumference : 0;
      return {
        offset: acc.offset + dash,
        items: [...acc.items, { label: segment.label, color: segment.color, dash, offset: acc.offset }],
      };
    },
    { offset: 0, items: [] },
  ).items;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={ariaLabel} className="mx-auto">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e5e3da" strokeWidth={strokeWidth} />
      {total > 0 &&
        laidOutSegments.map((segment) => (
          <circle
            key={segment.label}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={segment.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${segment.dash} ${circumference - segment.dash}`}
            strokeDashoffset={-segment.offset}
            strokeLinecap="butt"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            opacity={!activeLabel || activeLabel === segment.label ? 1 : 0.42}
            role={onSegmentSelect ? "button" : undefined}
            tabIndex={onSegmentSelect ? 0 : undefined}
            aria-label={`${segment.label} segment`}
            className={onSegmentSelect ? "cursor-pointer transition-opacity duration-150 hover:opacity-100" : undefined}
            onClick={onSegmentSelect ? () => onSegmentSelect(segment.label) : undefined}
            onKeyDown={
              onSegmentSelect
                ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSegmentSelect(segment.label);
                    }
                  }
                : undefined
            }
          />
        ))}
      <text x="50%" y="47%" textAnchor="middle" className="fill-[#0b3020] text-xl font-black">
        {centerLabel}
      </text>
      <text x="50%" y="58%" textAnchor="middle" className="fill-[#637064] text-[11px] font-black uppercase tracking-[0.12em]">
        {centerSubLabel}
      </text>
    </svg>
  );
}

function InsightRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-[#f8f7f1] px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <p className="min-w-0 text-sm font-bold text-[#637064]">{label}</p>
      </div>
      <p className="shrink-0 text-sm font-black text-[#0b3020]">{value}</p>
    </div>
  );
}

function ChannelInsight({ label, source, value, helper }: { label: string; source: string; value: string; helper: string }) {
  return (
    <div className="rounded-3xl bg-[#f8f7f1] p-4">
      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#637064]">{label}</p>
      <div className="mt-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-black">{source}</p>
          <p className="mt-1 text-xs font-semibold leading-5 text-[#637064]">{helper}</p>
        </div>
        <p className="shrink-0 text-lg font-black text-[#0b3020]">{value}</p>
      </div>
    </div>
  );
}

function SourceCard({ practice }: { practice: FunnelPracticeSummary }) {
  const sources = sourceTotalsFromRows(practice.rows);
  const max = Math.max(...sources.map((item) => item.leads), 1);
  const totalLeads = sources.reduce((sum, item) => sum + item.leads, 0);
  return (
    <section className="rounded-[2rem] bg-white p-5 shadow-sm ring-1 ring-black/5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#637064]">Source attribution</p>
          <h3 className="text-lg font-black tracking-[-0.03em]">Which channels created value?</h3>
        </div>
        <p className="text-sm font-semibold text-[#637064]">Lead source → replies → consults → treatment → payments</p>
      </div>
      <div className="mt-4 grid gap-4">
        {sources.slice(0, 8).map((item, index) => {
          const share = percent(item.leads, totalLeads);
          const bookedRate = percent(item.booked, item.leads);
          const replyRate = percent(item.replied, item.leads);
          return (
          <div key={item.source} className="rounded-3xl bg-[#f8f7f1] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: sourceColor(item.source, index) }} />
                  <p className="truncate text-base font-black">{item.source}</p>
                </div>
                <p className="mt-1 text-xs font-bold text-[#637064]">
                  {share} of leads · {replyRate} replied · {bookedRate} booked
                </p>
              </div>
              <div className="shrink-0 rounded-2xl bg-white px-3 py-2 text-right shadow-sm">
                <p className="text-lg font-black">{money(item.payments)}</p>
                <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[#637064]">payments</p>
              </div>
            </div>
            <div className="mt-3 h-3 overflow-hidden rounded-full bg-black/10">
              <div
                className="h-full rounded-full bg-[#0b3020]"
                style={{ width: `${Math.max(2, (item.leads / max) * 100)}%` }}
              />
            </div>
            <div className="mt-3 grid grid-cols-5 gap-2 text-center text-xs font-black text-[#637064]">
              <MetricPill label="Leads" value={numberFmt(item.leads)} />
              <MetricPill label="Replies" value={numberFmt(item.replied)} />
              <MetricPill label="Consults" value={numberFmt(item.booked)} />
              <MetricPill label="Treatment" value={numberFmt(item.treatment)} />
              <MetricPill label="Paid" value={numberFmt(item.paid)} />
            </div>
          </div>
          );
        })}
      </div>
    </section>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white px-2 py-2">
      <p className="text-sm font-black text-[#0b3020]">{value}</p>
      <p className="mt-0.5 text-[9px] font-black uppercase tracking-[0.08em] text-[#637064]">{label}</p>
    </div>
  );
}

function displaySource(source: string) {
  const normalized = source.trim().toLowerCase().replace(/\s+/g, " ");
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
  return aliases[normalized] || source.trim() || "Unknown";
}

function LeadDrawer({
  lead,
  notes,
  loading,
  onClose,
}: {
  lead: FunnelLeadRow;
  notes: FunnelNote[] | undefined;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <aside
        className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-[2rem] bg-white p-5 shadow-2xl sm:left-auto sm:right-4 sm:top-4 sm:h-[calc(100dvh-2rem)] sm:max-h-none sm:w-[460px] sm:rounded-[2rem]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#637064]">{lead.practiceLabel}</p>
            <h2 className="mt-1 text-2xl font-black tracking-[-0.04em]">{lead.patientName}</h2>
            <p className="mt-1 text-sm text-[#637064]">
              {lead.phone ?? "No phone"} · {lead.email ?? "No email"}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-[#f4f2ea] px-4 py-2 text-sm font-black">
            Close
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <MiniFact label="Source" value={lead.leadSource} />
          <MiniFact label="Stage" value={lead.boxStage ?? "Unknown"} />
          <MiniFact label="Messages" value={numberFmt(lead.conversationCount)} />
          <MiniFact label="Booked" value={lead.consultBooked ? "Yes" : "No"} />
          <MiniFact label="Treatment evidence" value={lead.treatmentEvidence ? "Yes" : "No"} />
          <MiniFact label="AI message" value={formatDateTime(lead.aiActionedAt)} />
          <MiniFact label="Consult date" value={formatDateTime(lead.dentallyConsultAt)} />
          <MiniFact label="Treatment date" value={formatDateTime(lead.dentallyTreatmentAt)} />
          <MiniFact label="Payment date" value={formatDateTime(lead.dentallyPaidAt)} />
          <MiniFact label="Attributed payment" value={lead.attributedPaymentRevenue > 0 ? money(lead.attributedPaymentRevenue) : "—"} />
          <MiniFact label="Deposit" value={lead.consultDepositRevenue > 0 ? money(lead.consultDepositRevenue) : "—"} />
          <MiniFact label="Plan payment" value={lead.monthlyPlanRevenue > 0 ? money(lead.monthlyPlanRevenue) : "—"} />
          <MiniFact label="Other paid" value={lead.otherPaidRevenue > 0 ? money(lead.otherPaidRevenue) : "—"} />
          <MiniFact label="Paid revenue" value={lead.hardPaidRevenue > 0 ? money(lead.hardPaidRevenue) : "—"} />
        </div>

        <section className="mt-5 rounded-3xl bg-[#f8f7f1] p-4">
          <p className="text-sm font-black">Attribution</p>
          <p className="mt-2 text-sm leading-6 text-[#637064]">{lead.attributionReason}</p>
          <p className="mt-2 text-sm font-bold leading-6 text-[#0b3020]">{lead.commercialSequence}</p>
          <p className="mt-2 text-xs font-bold uppercase tracking-[0.14em] text-[#0b3020]">
            Confidence: {lead.attributionConfidence}
          </p>
        </section>

        <section className="mt-5">
          <h3 className="text-sm font-black uppercase tracking-[0.14em] text-[#637064]">AI action note</h3>
          <p className="mt-2 rounded-3xl bg-[#0b3020] p-4 text-sm leading-6 text-white">
            {lead.actionedNote || "No AI action note recorded."}
          </p>
        </section>

        <section className="mt-5">
          <h3 className="text-sm font-black uppercase tracking-[0.14em] text-[#637064]">Boxly notes</h3>
          {loading ? (
            <p className="mt-2 rounded-2xl bg-[#f8f7f1] p-4 text-sm text-[#637064]">Loading notes...</p>
          ) : notes?.length ? (
            <div className="mt-2 grid gap-2">
              {notes.slice(0, 12).map((note) => (
                <div key={note.id} className="rounded-2xl bg-[#f8f7f1] p-4">
                  <p className="text-xs font-bold text-[#637064]">{formatDateTime(note.createdAt)}</p>
                  {note.title && <p className="mt-1 font-bold">{note.title}</p>}
                  <p className="mt-1 text-sm leading-6 text-[#49574b]">{note.description || "No description"}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 rounded-2xl bg-[#f8f7f1] p-4 text-sm text-[#637064]">No notes returned for this lead.</p>
          )}
        </section>

        <section className="mt-5 rounded-3xl border border-dashed border-black/15 p-4">
          <p className="text-sm font-black">Dentally evidence</p>
          <p className="mt-2 text-sm leading-6 text-[#637064]">
            {lead.dentallyPatientId
              ? `Matched Dentally patient ${lead.dentallyPatientId}. ${
                  lead.treatmentEvidenceReason ?? "No treatment evidence reason recorded."
                }`
              : "No matched Dentally patient in the current attribution data."}
          </p>
          {lead.estimatedTreatmentOpportunity > 0 && (
            <p className="mt-2 text-sm font-bold text-[#92400e]">
              Known treatment value: {money(lead.estimatedTreatmentOpportunity)}
            </p>
          )}
          {lead.hardPaidRevenue > 0 && (
            <p className="mt-2 text-sm font-bold text-[#166534]">Hard paid revenue: {money(lead.hardPaidRevenue)}</p>
          )}
        </section>
      </aside>
    </div>
  );
}

function MiniFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[#f8f7f1] p-3">
      <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#637064]">{label}</p>
      <p className="mt-1 truncate text-sm font-black">{value}</p>
    </div>
  );
}

function Badge({ children, tone }: { children: string; tone: "green" | "blue" | "amber" }) {
  const classes = {
    green: "bg-[#dcfce7] text-[#166534]",
    blue: "bg-[#dbeafe] text-[#1d4ed8]",
    amber: "bg-[#fef3c7] text-[#92400e]",
  };
  return <span className={`rounded-full px-2 py-1 text-[11px] font-black ${classes[tone]}`}>{children}</span>;
}

function LoadingState() {
  return (
    <div className="grid gap-4">
      <div className="h-44 rounded-[2rem] bg-white/70 skeleton" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-28 rounded-3xl bg-white/70 skeleton" />
        ))}
      </div>
      <div className="h-96 rounded-[2rem] bg-white/70 skeleton" />
    </div>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function numberFmt(value: number) {
  return new Intl.NumberFormat("en-GB").format(value);
}

function money(value: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value);
}

function percent(value: number, total: number) {
  if (!total) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

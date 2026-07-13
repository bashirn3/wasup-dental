"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AccountMenu from "@/components/auth/AccountMenu";

type PracticeKey = "regent" | "nuyu";
type StatusFilter = "all" | "replied" | "booked" | "treatment" | "paid";

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
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-4 sm:px-6 lg:px-8">
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
            <h2 className="mt-3 text-2xl font-black tracking-[-0.04em]">No merged snapshot yet</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#637064]">
              This dashboard is now read-only. It only displays a saved V1 + Dentally evidence snapshot, so it will not
              run live Dentally enrichment while someone is viewing the page.
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
                  </p>
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

            <KpiGrid practice={activePractice} dentallyPending={data?.dentally.status === "not_enriched"} />

            <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <FunnelCard practice={activePractice} dentallyPending={data?.dentally.status === "not_enriched"} />
              <SourceCard practice={activePractice} />
            </section>

            <section className="rounded-[2rem] bg-white p-4 shadow-sm ring-1 ring-black/5 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-lg font-black tracking-[-0.03em]">Lead evidence</h3>
                  <p className="text-sm text-[#637064]">{rows.length} visible leads from V1 engagement data.</p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search name, phone, source..."
                    className="h-11 rounded-2xl border border-black/10 bg-[#f8f7f1] px-4 text-sm outline-none focus:border-[#0b3020]"
                  />
                  <div className="flex gap-1 rounded-2xl bg-[#f8f7f1] p-1">
                    {statusOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setStatus(option.value)}
                        className={`rounded-xl px-3 py-2 text-xs font-bold ${
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
                    className="h-11 rounded-2xl border border-black/10 bg-[#f8f7f1] px-3 text-sm font-bold outline-none focus:border-[#0b3020]"
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
                    className="rounded-3xl bg-[#f8f7f1] p-4 text-left transition hover:bg-[#f0eedf]"
                  >
                    <div className="flex items-start gap-3">
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
                      <div className="text-right">
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
                    Paid treatment data is pending until the cached Dentally snapshot is run.
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

function KpiGrid({ practice, dentallyPending }: { practice: FunnelPracticeSummary; dentallyPending: boolean }) {
  const cards = [
    { label: "Leads reached", value: numberFmt(practice.leadsReached), helper: "AI actioned in V1" },
    { label: "Patients replied", value: numberFmt(practice.patientsReplied), helper: "Client replied" },
    { label: "Consults booked", value: numberFmt(practice.consultsBooked), helper: "Using V1 booking evidence" },
    { label: "Booked consult value", value: money(practice.consultBookingValue), helper: "Booked × £65" },
    {
      label: "Attributed payments",
      value: dentallyPending ? "Pending" : money(practice.attributedPaymentRevenue),
      helper: dentallyPending ? "Needs Dentally paid invoices" : "All matched paid invoices",
    },
    {
      label: "Full treatment paid",
      value: dentallyPending ? "Pending" : money(practice.hardPaidTreatmentRevenue),
      helper: dentallyPending ? "Needs Dentally paid invoices" : `${practice.paidTreatmentCount} large paid invoices`,
    },
    {
      label: "Consult deposits",
      value: dentallyPending ? "Pending" : money(practice.consultDepositRevenue),
      helper: "£65/£30 paid rows",
    },
    {
      label: "Plan payments",
      value: dentallyPending ? "Pending" : money(practice.monthlyPlanRevenue),
      helper: "£154 treatment-on-plan rows",
    },
    {
      label: "Other paid",
      value: dentallyPending ? "Pending" : money(practice.otherPaidRevenue),
      helper: "Paid rows below full-treatment threshold",
    },
    {
      label: "Known treatment value",
      value: dentallyPending ? "Pending" : money(practice.estimatedTreatmentOpportunity),
      helper: dentallyPending
        ? "Needs Dentally treatment evidence"
        : `${practice.treatmentOpportunityCount} treatment leads · no fallback`,
    },
    {
      label: "Treatment evidence",
      value: dentallyPending ? "Pending" : numberFmt(practice.treatmentOpportunityCount + practice.paidTreatmentCount),
      helper: dentallyPending ? "Needs Dentally snapshot" : `${practice.paidTreatmentCount} paid · ${practice.treatmentOpportunityCount} not paid`,
    },
    { label: "Messages exchanged", value: numberFmt(practice.totalMessagesExchanged), helper: "V1 conversation count" },
    { label: "Meta cost saving", value: money(practice.metaApiCostSavings), helper: "Messages × £0.07" },
  ];

  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#637064]">{card.label}</p>
          <p className="mt-2 text-2xl font-black tracking-[-0.04em] sm:text-3xl">{card.value}</p>
          <p className="mt-1 text-xs text-[#637064]">{card.helper}</p>
        </div>
      ))}
    </section>
  );
}

function FunnelCard({ practice, dentallyPending }: { practice: FunnelPracticeSummary; dentallyPending: boolean }) {
  return (
    <section className="rounded-[2rem] bg-white p-5 shadow-sm ring-1 ring-black/5">
      <h3 className="text-lg font-black tracking-[-0.03em]">Sales funnel</h3>
      <div className="mt-5 grid gap-3">
        {practice.funnel.map((step, index) => {
          const previous = index === 0 ? step.value : practice.funnel[index - 1]?.value || 0;
          return (
            <div key={step.key} className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#0b3020] text-sm font-black text-white">
                {index + 1}
              </div>
              <div className="min-w-0 flex-1 rounded-2xl bg-[#f8f7f1] p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-black">{step.label}</p>
                  <p className="text-xl font-black">{dentallyPending && step.key === "paid" ? "Pending" : numberFmt(step.value)}</p>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/10">
                  <div
                    className="h-full rounded-full bg-[#c8ee4e]"
                    style={{
                      width: `${dentallyPending && step.key === "paid" ? 4 : Math.max(4, Math.min(100, previous ? (step.value / previous) * 100 : 0))}%`,
                    }}
                  />
                </div>
                <p className="mt-2 text-xs text-[#637064]">
                  {dentallyPending && step.key === "paid" ? "Requires cached Dentally revenue snapshot" : step.helper}
                  {index > 0 && !(dentallyPending && step.key === "paid")
                    ? ` · ${percent(step.value, previous)} of previous step`
                    : ""}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SourceCard({ practice }: { practice: FunnelPracticeSummary }) {
  const max = Math.max(...practice.sourceBreakdown.map((item) => item.leads), 1);
  return (
    <section className="rounded-[2rem] bg-white p-5 shadow-sm ring-1 ring-black/5">
      <h3 className="text-lg font-black tracking-[-0.03em]">Lead sources</h3>
      <div className="mt-4 grid gap-3">
        {practice.sourceBreakdown.map((item) => (
          <div key={item.source}>
            <div className="flex items-center justify-between gap-3 text-sm">
              <p className="truncate font-bold">{item.source}</p>
              <p className="font-black">{item.leads}</p>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/10">
              <div className="h-full rounded-full bg-[#0b3020]" style={{ width: `${(item.leads / max) * 100}%` }} />
            </div>
            <p className="mt-1 text-xs text-[#637064]">
              {item.replied} replied · {item.booked} booked
            </p>
          </div>
        ))}
      </div>
    </section>
  );
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
            {lead.actionedNote || "No AI action note in V1 snapshot."}
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
              : "No Dentally patient match in the current evidence snapshot."}
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

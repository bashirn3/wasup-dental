"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import AccountMenu from "@/components/auth/AccountMenu";
import { MIcon } from "@/components/mot/icons";
import { defaultAgentPrompt, defaultFirstMessage, treatmentLabels } from "@/lib/dental-demo-data";
import type { DentalDashboardData, DentalLead, DentalMessage } from "@/lib/dental-types";

type TabKey = "dashboard" | "leads" | "activity" | "agent" | "connect";
type LeadFilters = {
  q: string;
  status: string;
  box: string;
  stage: string;
};
type ActivityFilters = {
  q: string;
  status: string;
  box: string;
};

const tabs: [TabKey, string, typeof MIcon.users][] = [
  ["dashboard", "Dashboard", MIcon.chart],
  ["leads", "Leads", MIcon.users],
  ["activity", "Activity", MIcon.check],
  ["agent", "Agent", MIcon.spark],
  ["connect", "Connect", MIcon.gear],
];

const CLERK_ON = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
const ACTIVE_WORKSPACE_KEY = "wasup-dental-active-workspace";
const PAGE_SIZE = 50;
const emptyFilters: LeadFilters = { q: "", status: "", box: "", stage: "" };
const emptyActivityFilters: ActivityFilters = { q: "", status: "", box: "" };

export default function DentalApp() {
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [data, setData] = useState<DentalDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [firstMessage, setFirstMessage] = useState(defaultFirstMessage);
  const [prompt, setPrompt] = useState(defaultAgentPrompt);
  const [assistantName, setAssistantName] = useState("");
  const [openingHours, setOpeningHours] = useState("");
  const [closingHours, setClosingHours] = useState("");
  const [knowledge, setKnowledge] = useState("");
  const [treatmentFirstMessages, setTreatmentFirstMessages] = useState<Record<string, string>>({});
  const [configVersion, setConfigVersion] = useState<number | null>(null);
  const [confirmSave, setConfirmSave] = useState(false);
  const [leadFilters, setLeadFilters] = useState<LeadFilters>(emptyFilters);
  const [loadingMore, setLoadingMore] = useState(false);
  const [chatMessages, setChatMessages] = useState<DentalMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [activePracticeId, setActivePracticeId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(ACTIVE_WORKSPACE_KEY);
  });

  const load = useCallback(async (options: { offset?: number; append?: boolean } = {}) => {
    const offset = options.offset ?? 0;
    if (options.append) setLoadingMore(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (activePracticeId) params.set("practiceId", activePracticeId);
      if (leadFilters.q.trim()) params.set("q", leadFilters.q.trim());
      if (leadFilters.status) params.set("status", leadFilters.status);
      if (leadFilters.box) params.set("box", leadFilters.box);
      if (leadFilters.stage) params.set("stage", leadFilters.stage);

      const res = await fetch(`/api/dashboard-data?${params.toString()}`, { cache: "no-store" });
      const payload = await res.json();
      setData((prev) =>
        options.append && prev
          ? {
              ...payload,
              leads: [...prev.leads, ...(payload.leads ?? [])],
            }
          : payload,
      );
      if (payload.practiceId && payload.practiceId !== activePracticeId) {
        setActivePracticeId(payload.practiceId);
        window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, payload.practiceId);
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [activePracticeId, leadFilters]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    async function loadConfig() {
      const res = await fetch("/api/agent-config", { cache: "no-store" });
      const payload = await res.json().catch(() => ({}));
      if (payload.config) {
        const editable = payload.config.clientEditable ?? {};
        setFirstMessage(payload.config.firstMessage ?? defaultFirstMessage);
        setPrompt(payload.config.prompt ?? defaultAgentPrompt);
        setAssistantName(editable.assistantName ?? "");
        setOpeningHours(editable.openingHours ?? "");
        setClosingHours(editable.closingHours ?? "");
        setKnowledge(editable.knowledge ?? "");
        setTreatmentFirstMessages(
          editable.treatmentFirstMessages && typeof editable.treatmentFirstMessages === "object"
            ? editable.treatmentFirstMessages
            : {},
        );
        setConfigVersion(
          typeof payload.config.versionNumber === "number" ? payload.config.versionNumber : null,
        );
      }
    }
    void loadConfig();
  }, []);

  const leads = useMemo(() => data?.leads ?? [], [data]);
  const workspaces = data?.workspaces ?? [];
  const selectedLead = useMemo(
    () =>
      [...leads, ...(data?.activityLeads ?? [])].find((lead) => lead.id === selectedLeadId) ?? null,
    [data?.activityLeads, leads, selectedLeadId],
  );
  const stats = useMemo(() => buildStats(leads, data?.metrics), [leads, data?.metrics]);

  useEffect(() => {
    if (!selectedLead) {
      setChatMessages([]);
      return;
    }

    setChatMessages(selectedLead.messages);
    setChatLoading(true);
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (data?.practiceId) params.set("practiceId", data.practiceId);

    fetch(`/api/chats/${selectedLead.id}?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((payload) => {
        if (Array.isArray(payload.messages)) setChatMessages(payload.messages);
      })
      .catch((error) => {
        if (error?.name !== "AbortError") setChatMessages(selectedLead.messages);
      })
      .finally(() => setChatLoading(false));

    return () => controller.abort();
  }, [data?.practiceId, selectedLead]);

  async function provisionDrafts() {
    setProvisioning(true);
    try {
      await fetch("/api/workflows/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ practiceId: data?.practiceId }),
      });
      await load();
    } finally {
      setProvisioning(false);
    }
  }

  async function saveAgent() {
    setSaveState("saving");
    try {
      const res = await fetch("/api/agent-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          practiceId: data?.practiceId,
          firstMessage,
          prompt,
          assistantName,
          openingHours,
          closingHours,
          knowledge,
          treatmentFirstMessages,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (res.ok) {
        if (typeof payload.config?.versionNumber === "number") {
          setConfigVersion(payload.config.versionNumber);
        }
        setSaveState("saved");
      } else {
        setSaveState("error");
      }
    } catch {
      setSaveState("error");
    }
  }

  if (loading || !data) {
    return (
      <main className="min-h-dvh bg-paper px-5 py-6">
        <div className="mx-auto max-w-6xl animate-pulse space-y-4">
          <div className="h-10 w-44 rounded-2xl bg-pine/10" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-24 rounded-card bg-pine/10" />
            ))}
          </div>
          <div className="h-[60vh] rounded-[2rem] bg-pine/10" />
        </div>
      </main>
    );
  }

  if (!data.sourceHealth) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-paper px-5 text-ink">
        <div className="max-w-md rounded-[2rem] bg-white p-6 text-center shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight">No workspace access</h1>
          <p className="mt-2 text-sm leading-6 text-ink/55">
            Your account is not connected to a dental practice yet. Ask an admin to invite you,
            or start a new practice setup.
          </p>
          <Link
            href="/start?new=1"
            className="mt-5 inline-flex rounded-full bg-pine px-5 py-3 text-sm font-semibold text-lime"
          >
            Set up a practice
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-paper pb-24 text-ink md:pb-0">
      <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 pb-4 pt-5 sm:px-6 md:py-8">
        <header className="rounded-[2rem] bg-pine p-5 text-paper shadow-[0_20px_70px_-45px_rgba(8,34,22,0.8)] md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-lime/80">
                Wasup Dental
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-5xl">
                {data.practice?.name ?? "Dental workspace"}
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-paper/65">
                Review conversations, follow-up, and booking progress from one workspace.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {workspaces.length > 1 && (
                <select
                  value={data.practiceId ?? ""}
                  onChange={(event) => {
                    const next = event.target.value;
                    setActivePracticeId(next);
                    setSelectedLeadId(null);
                    setLeadFilters(emptyFilters);
                    window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, next);
                    setLoading(true);
                  }}
                  className="hidden rounded-full border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold text-paper outline-none transition hover:bg-white/15 sm:block"
                  aria-label="Switch practice"
                >
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id} className="text-ink">
                      {workspace.name}
                    </option>
                  ))}
                </select>
              )}
              <Link
                href="/start?new=1"
                className="hidden rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-paper/80 transition hover:bg-white/10 sm:inline-flex"
              >
                New practice
              </Link>
              {CLERK_ON ? (
                <AccountMenu variant="mobile" />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-lime">
                  W
                </span>
              )}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Total leads" value={data.metrics?.leadTotal ?? stats.total} />
            <Stat label="Contacted" value={stats.aiActioned} />
            <Stat label="Needs staff" value={stats.needsHuman} />
            <Stat label="Booked" value={stats.booked} />
            <Stat label="Replies" value={data.metrics?.clientRepliedTotal ?? leads.filter((lead) => lead.clientReplied).length} />
          </div>
        </header>

        <div className="mt-4 hidden rounded-full bg-white p-1 shadow-sm md:flex">
          {tabs.map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold transition ${
                tab === key ? "bg-pine text-lime" : "text-ink/55 hover:bg-mist"
              }`}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </div>

        {(tab === "leads" || tab === "activity") && data.laneSummary?.length ? (
          <LaneOverview
            lanes={data.laneSummary}
            activeLane={leadFilters.box}
            onSelectLane={(lane) => {
              setTab("leads");
              setSelectedLeadId(null);
              setLeadFilters({ ...emptyFilters, box: lane });
              setLoading(true);
            }}
          />
        ) : null}

        <section className="mt-4 flex-1">
          {tab === "dashboard" && (
            <AnalyticsPanel data={data} stats={stats} practiceId={data.practiceId ?? null} />
          )}
          {tab === "leads" && (
            <LeadsPanel
              leads={leads}
              selectedLead={selectedLead}
              totalLeads={data.metrics?.leadTotal ?? leads.length}
              filteredTotal={data.metrics?.filteredLeadTotal ?? data.metrics?.leadTotal ?? leads.length}
              facets={data.facets}
              filters={leadFilters}
              hasMore={Boolean(data.pageInfo?.hasMore)}
              loadingMore={loadingMore}
              onFiltersChange={(filters) => {
                setSelectedLeadId(null);
                setLeadFilters(filters);
                setLoading(true);
              }}
              onLoadMore={() => void load({ offset: leads.length, append: true })}
              onSelect={setSelectedLeadId}
            />
          )}
          {tab === "activity" && (
            <ActivityPanel
              data={data}
              selectedLeadId={selectedLeadId}
              onSelectLead={setSelectedLeadId}
            />
          )}
          {tab === "agent" && (
            <AgentPanel
              practiceName={data.practice?.name ?? "your practice"}
              assistantName={assistantName}
              openingHours={openingHours}
              closingHours={closingHours}
              knowledge={knowledge}
              treatmentFirstMessages={treatmentFirstMessages}
              firstMessage={firstMessage}
              prompt={prompt}
              saveState={saveState}
              configVersion={configVersion}
              onAssistantName={setAssistantName}
              onOpeningHours={setOpeningHours}
              onClosingHours={setClosingHours}
              onKnowledge={setKnowledge}
              onTreatmentFirstMessage={(id, value) =>
                setTreatmentFirstMessages((prev) => ({ ...prev, [id]: value }))
              }
              onFirstMessage={setFirstMessage}
              onPrompt={setPrompt}
              onRequestSave={() => setConfirmSave(true)}
            />
          )}
          {tab === "connect" && (
            <ConnectPanel data={data} provisioning={provisioning} onProvision={provisionDrafts} />
          )}
        </section>
      </div>

      <LeadDrawer
        lead={selectedLead}
        messages={chatMessages}
        loading={chatLoading}
        onClose={() => setSelectedLeadId(null)}
      />

      {confirmSave && (
        <ConfirmSaveDialog
          practiceName={data.practice?.name ?? "your practice"}
          busy={saveState === "saving"}
          onCancel={() => setConfirmSave(false)}
          onConfirm={async () => {
            await saveAgent();
            setConfirmSave(false);
          }}
        />
      )}

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-black/5 bg-white/95 px-3 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 shadow-2xl backdrop-blur md:hidden">
        <div className="grid grid-cols-4 gap-1">
          {tabs.map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`relative flex flex-col items-center justify-center rounded-2xl px-2 py-2 text-[11px] font-semibold transition ${
                tab === key ? "bg-pine text-lime" : "text-ink/50"
              }`}
            >
              <Icon size={20} />
              <span className="mt-1">{label}</span>
            </button>
          ))}
        </div>
      </nav>
    </main>
  );
}

function Stat({ label, value, text = false }: { label: string; value: number | string; text?: boolean }) {
  return (
    <div className="rounded-2xl bg-white/10 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-paper/45">{label}</p>
      <p className={`${text ? "text-xl" : "text-3xl"} mt-1 font-semibold tracking-tight text-lime`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
    </div>
  );
}

function LaneOverview({
  lanes,
  activeLane,
  onSelectLane,
}: {
  lanes: NonNullable<DentalDashboardData["laneSummary"]>;
  activeLane: string;
  onSelectLane: (lane: string) => void;
}) {
  return (
    <section className="mt-4 rounded-[2rem] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3 px-1">
        <div>
          <h2 className="text-sm font-semibold">Lane overview</h2>
          <p className="text-xs text-ink/45">Tap a lane to filter leads by treatment or stage.</p>
        </div>
        {activeLane && <LanePill label={`Filtered: ${activeLane}`} />}
      </div>
      <div className="mt-4 flex gap-3 overflow-x-auto pb-1">
        {lanes.map((lane) => (
          <button
            key={lane.name}
            type="button"
            onClick={() => onSelectLane(lane.name)}
            className={`min-w-[210px] rounded-2xl border px-4 py-3 text-left transition ${
              activeLane === lane.name
                ? "border-pine bg-pine text-paper"
                : "border-line bg-mist/50 hover:border-pine/20 hover:bg-white"
            }`}
          >
            <p className="truncate text-sm font-semibold">{lane.name}</p>
            <p
              className={`mt-2 text-3xl font-semibold tracking-tight ${
                activeLane === lane.name ? "text-lime" : "text-ink"
              }`}
            >
              {lane.total.toLocaleString()}
            </p>
            <div
              className={`mt-2 grid grid-cols-3 gap-2 text-[11px] ${
                activeLane === lane.name ? "text-paper/60" : "text-ink/45"
              }`}
            >
              <span>{lane.aiActioned.toLocaleString()} AI</span>
              <span>{lane.needsHuman.toLocaleString()} staff</span>
              <span>{lane.booked.toLocaleString()} booked</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function LeadsPanel({
  leads,
  selectedLead,
  totalLeads,
  filteredTotal,
  facets,
  filters,
  hasMore,
  loadingMore,
  onFiltersChange,
  onLoadMore,
  onSelect,
}: {
  leads: DentalLead[];
  selectedLead: DentalLead | null;
  totalLeads: number;
  filteredTotal: number;
  facets?: DentalDashboardData["facets"];
  filters: LeadFilters;
  hasMore: boolean;
  loadingMore: boolean;
  onFiltersChange: (filters: LeadFilters) => void;
  onLoadMore: () => void;
  onSelect: (id: string) => void;
}) {
  const filtered = filteredTotal !== totalLeads;

  return (
    <div className="overflow-hidden rounded-[2rem] bg-white shadow-sm">
      <div className="border-b border-line px-5 py-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Leads</h2>
            <p className="text-sm text-ink/50">
              Search every patient and lead in this workspace.
            </p>
            <p className="mt-1 text-xs text-ink/35">
              Showing {leads.length.toLocaleString()} of{" "}
              {(filtered ? filteredTotal : totalLeads).toLocaleString()} leads
              {filtered ? ` filtered from ${totalLeads.toLocaleString()} total.` : "."}
            </p>
          </div>
          {(filters.q || filters.status || filters.box || filters.stage) && (
            <button
              type="button"
              onClick={() => onFiltersChange(emptyFilters)}
              className="rounded-full bg-mist px-3 py-2 text-xs font-semibold text-ink/55 transition hover:text-ink"
            >
              Clear filters
            </button>
          )}
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1.4fr)_1fr_1fr_1fr]">
          <input
            value={filters.q}
            onChange={(event) => onFiltersChange({ ...filters, q: event.target.value })}
            placeholder="Search name, phone, lane, or stage"
            className="rounded-2xl border border-line bg-mist/50 px-4 py-3 text-sm outline-none transition focus:border-pine/30 focus:bg-white"
          />
          <FilterSelect
            label="Status"
            value={filters.status}
            options={facets?.statuses ?? []}
            onChange={(value) => onFiltersChange({ ...filters, status: value })}
          />
          <FilterSelect
            label="Lane"
            value={filters.box}
            options={facets?.boxes ?? []}
            onChange={(value) => onFiltersChange({ ...filters, box: value })}
          />
          <FilterSelect
            label="Stage"
            value={filters.stage}
            options={facets?.stages ?? []}
            onChange={(value) => onFiltersChange({ ...filters, stage: value })}
          />
        </div>
      </div>
      <div className="divide-y divide-line">
        {leads.length ? leads.map((lead) => (
          <button
            key={lead.id}
            onClick={() => onSelect(lead.id)}
            className={`flex w-full items-start gap-3 px-5 py-4 text-left transition hover:bg-mist ${
              selectedLead?.id === lead.id ? "bg-mist" : ""
            }`}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-pine text-sm font-semibold text-lime">
              {lead.name.charAt(0)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate font-semibold">{lead.name}</span>
                {lead.needsHuman && (
                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                    Staff
                  </span>
                )}
                {lead.clientReplied && (
                  <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                    Replied
                  </span>
                )}
              </span>
              <span className="mt-1 flex flex-wrap gap-1.5">
                <LanePill label={lead.boxName ?? lead.sourceSystem} />
                <LanePill label={lead.boxStage ?? lead.status} muted />
                <LanePill label={treatmentLabels[lead.treatment]} muted />
                {lead.aiActioned && <LanePill label="Contacted" muted />}
                {lead.conversationCount > 0 && <LanePill label={`${lead.conversationCount} messages`} muted />}
              </span>
              <span className="mt-2 block truncate text-sm text-ink/55">
                {lead.leadSummary ?? lead.lastMessage}
              </span>
            </span>
          </button>
        )) : (
          <div className="px-5 py-12 text-center">
            <p className="font-semibold">No leads match these filters.</p>
            <p className="mt-1 text-sm text-ink/50">Clear the filters or try a broader search.</p>
          </div>
        )}
      </div>
      {hasMore && (
        <div className="border-t border-line p-4">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="w-full rounded-full bg-pine px-5 py-3 text-sm font-semibold text-lime transition hover:brightness-110 disabled:opacity-50"
          >
            {loadingMore ? "Loading more..." : "Load more leads"}
          </button>
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-line bg-mist/50 px-4 py-3 text-sm outline-none transition focus:border-pine/30 focus:bg-white"
      >
        <option value="">{label}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {humanize(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function LeadDrawer({
  lead,
  messages,
  loading,
  onClose,
}: {
  lead: DentalLead | null;
  messages: DentalMessage[];
  loading: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"chat" | "details" | "notes">("chat");
  const sortedMessages = [...messages].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!lead) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close patient panel"
        onClick={onClose}
        className="absolute inset-0 bg-pine-deep/35 backdrop-blur-[2px]"
      />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col bg-white shadow-2xl">
        <div className="border-b border-line px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="truncate text-lg font-semibold">{lead.name}</h3>
              <p className="mt-1 text-xs text-ink/45">{lead.phone || lead.email || "No contact saved"}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <LanePill label={lead.boxName ?? "Unassigned"} />
                <LanePill label={lead.boxStage ?? lead.status} muted />
                {lead.needsHuman && <LanePill label="Needs staff" muted />}
                {lead.clientReplied && <LanePill label="Patient replied" muted />}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-mist px-3 py-2 text-xs font-semibold text-ink/55 transition hover:text-ink"
            >
              Close
            </button>
          </div>
        </div>

        <div className="border-b border-line bg-white px-3 py-2">
          <div className="grid grid-cols-3 rounded-full bg-mist p-1">
            {[
              ["chat", `Chat (${messages.length})`],
              ["details", "Details"],
              ["notes", "Notes"],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key as "chat" | "details" | "notes")}
                className={`rounded-full px-3 py-2 text-xs font-semibold transition ${
                  tab === key ? "bg-pine text-lime" : "text-ink/50 hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "chat" && (
            <div className="min-h-full space-y-3 bg-[#eee9e1] p-4">
              {loading && !sortedMessages.length ? (
                <p className="py-8 text-center text-sm text-ink/45">Loading conversation...</p>
              ) : sortedMessages.length ? (
                sortedMessages.map((message) => (
                  <div
                    key={message.id}
                    className={`max-w-[86%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                      message.direction === "outbound"
                        ? "ml-auto rounded-br-sm bg-[#d9fdd3]"
                        : "rounded-bl-sm bg-white"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{message.body}</p>
                    <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-ink/35">
                      {message.aiGenerated ? "Assistant" : message.direction === "inbound" ? "Patient" : "Team"}
                      {" · "}
                      {formatDateTime(message.createdAt)}
                    </p>
                  </div>
                ))
              ) : (
                <p className="py-8 text-center text-sm text-ink/45">No conversation imported for this lead yet.</p>
              )}
              {loading && sortedMessages.length > 0 && (
                <p className="text-center text-xs font-semibold uppercase tracking-wider text-ink/35">
                  Refreshing conversation...
                </p>
              )}
            </div>
          )}

          {tab === "details" && (
            <div className="space-y-5 p-5">
              {lead.leadSummary && (
                <div className="rounded-2xl bg-mist px-4 py-3 text-sm leading-6 text-ink/65">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/35">Summary</p>
                  {lead.leadSummary}
                </div>
              )}
              <div className="grid gap-4 text-sm sm:grid-cols-2">
                <Detail label="Treatment" value={treatmentLabels[lead.treatment]} />
                <Detail label="Status" value={humanize(lead.status)} />
                <Detail label="Lane" value={lead.boxName ?? "Unassigned"} />
                <Detail label="Stage" value={lead.boxStage ?? "Unknown"} />
                <Detail label="Phone" value={lead.phone || "Not saved"} />
                <Detail label="Email" value={lead.email || "Not saved"} />
                <Detail label="Messages" value={lead.conversationCount.toLocaleString()} />
                <Detail label="Became lead" value={formatDateTime(lead.becameLeadAt)} />
                <Detail label="Contacted" value={formatDateTime(lead.aiActionedAt ?? lead.actionedAt)} />
                <Detail label="Last updated" value={formatDateTime(lead.lastUpdatedAt ?? lead.updatedAt)} />
                {lead.entryPoint && <Detail label="Entry point" value={lead.entryPoint} wide />}
                {lead.actionedNote && <Detail label="Internal note" value={lead.actionedNote} wide />}
              </div>
            </div>
          )}

          {tab === "notes" && (
            <div className="flex min-h-full flex-col items-center justify-center p-8 text-center">
              <p className="font-semibold">Notes are coming next.</p>
              <p className="mt-2 max-w-xs text-sm leading-6 text-ink/50">
                For now, review the conversation and patient details here. Internal notes will stay separate from patient replies.
              </p>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function ActivityPanel({
  data,
  selectedLeadId,
  onSelectLead,
}: {
  data: DentalDashboardData;
  selectedLeadId: string | null;
  onSelectLead: (leadId: string) => void;
}) {
  const [filters, setFilters] = useState<ActivityFilters>(emptyActivityFilters);
  const metrics = data.metrics;
  const total = Math.max(metrics?.leadTotal ?? data.leads.length, 1);
  const sourceLeads = data.activityLeads?.length ? data.activityLeads : data.leads;
  const activityLeads = sourceLeads
    .filter((lead) => lead.aiActioned || lead.actioned || lead.clientReplied || lead.needsHuman || lead.status === "booked")
    .filter((lead) => {
      const search = filters.q.trim().toLowerCase();
      const statusMatches =
        !filters.status ||
        (filters.status === "contacted" && (lead.aiActioned || lead.actioned)) ||
        (filters.status === "patient_replied" && lead.clientReplied) ||
        (filters.status === "needs_staff" && lead.needsHuman) ||
        (filters.status === "booked" && lead.status === "booked");
      const laneMatches = !filters.box || lead.boxName === filters.box;
      const searchMatches =
        !search ||
        [lead.name, lead.phone, lead.email, lead.boxName, lead.boxStage, lead.leadSummary, lead.lastMessage]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search));

      return statusMatches && laneMatches && searchMatches;
    })
    .sort((a, b) => compareActivityDesc(activityTimestamp(a), activityTimestamp(b)));
  const needsAttention = activityLeads.filter((lead) => lead.needsHuman || lead.clientReplied).slice(0, 6);
  const statusOptions = ["contacted", "patient_replied", "needs_staff", "booked"];
  const hasFilters = filters.q || filters.status || filters.box;
  const engagementCards = [
    {
      label: "Contacted",
      value: metrics?.aiActionedTotal ?? sourceLeads.filter((lead) => lead.aiActioned || lead.actioned).length,
      detail: `${Math.round(((metrics?.aiActionedTotal ?? 0) / total) * 100)}% of leads`,
    },
    {
      label: "Patient replied",
      value: metrics?.clientRepliedTotal ?? sourceLeads.filter((lead) => lead.clientReplied).length,
      detail: "Replies to review",
    },
    {
      label: "Needs staff",
      value: metrics?.needsHumanTotal ?? 0,
      detail: "Requires follow-up",
    },
    {
      label: "Booked",
      value: metrics?.bookedTotal ?? 0,
      detail: `${Math.round(((metrics?.bookedTotal ?? 0) / total) * 100)}% booked`,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-[2rem] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/40">Activity</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">Follow-up that needs attention.</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/50">
              Track contacted leads, patient replies, bookings, and conversations.
            </p>
          </div>
          {hasFilters && (
            <button
              type="button"
              onClick={() => setFilters(emptyActivityFilters)}
              className="rounded-full bg-mist px-3 py-2 text-xs font-semibold text-ink/55 transition hover:text-ink"
            >
              Clear filters
            </button>
          )}
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {engagementCards.map((card) => (
            <div key={card.label} className="rounded-2xl bg-mist/70 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/40">{card.label}</p>
              <p className="mt-2 text-3xl font-semibold tracking-tight">{card.value.toLocaleString()}</p>
              <p className="mt-1 text-xs text-ink/45">{card.detail}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="overflow-hidden rounded-[2rem] bg-white shadow-sm">
          <div className="border-b border-line px-5 py-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="font-semibold">Recent activity</h3>
                <p className="mt-1 text-sm text-ink/50">
                  Open a lead to review the conversation and outreach timeline.
                </p>
              </div>
              <p className="text-xs text-ink/35">
                Showing {activityLeads.length.toLocaleString()} active leads
              </p>
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1.4fr)_1fr_1fr]">
              <input
                value={filters.q}
                onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}
                placeholder="Search patient, phone, lane, or summary"
                className="rounded-2xl border border-line bg-mist/50 px-4 py-3 text-sm outline-none transition focus:border-pine/30 focus:bg-white"
              />
              <FilterSelect
                label="Status"
                value={filters.status}
                options={statusOptions}
                onChange={(value) => setFilters((current) => ({ ...current, status: value }))}
              />
              <FilterSelect
                label="Lane"
                value={filters.box}
                options={data.facets?.boxes ?? []}
                onChange={(value) => setFilters((current) => ({ ...current, box: value }))}
              />
            </div>
          </div>
          <div className="divide-y divide-line">
            {activityLeads.length ? activityLeads.map((lead) => (
              <ActivityLeadRow
                key={lead.id}
                lead={lead}
                selected={selectedLeadId === lead.id}
                onSelect={() => onSelectLead(lead.id)}
              />
            )) : (
              <div className="px-5 py-12 text-center">
                <p className="font-semibold">No activity matches these filters.</p>
                <p className="mt-1 text-sm text-ink/50">Clear the filters or try a wider search.</p>
              </div>
            )}
          </div>
        </div>
        <ActivitySidePanel leads={needsAttention} lanes={data.laneSummary ?? []} onSelectLead={onSelectLead} />
      </div>
    </div>
  );
}

function ActivityLeadRow({
  lead,
  selected,
  onSelect,
}: {
  lead: DentalLead;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full px-5 py-4 text-left transition hover:bg-mist ${selected ? "bg-mist" : ""}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-sm font-semibold ${
            lead.clientReplied
              ? "bg-sky-50 text-sky-700"
              : lead.needsHuman
                ? "bg-red-50 text-red-700"
                : "bg-pine text-lime"
          }`}
        >
          {lead.clientReplied ? "R" : lead.needsHuman ? "!" : "A"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold">{lead.name}</span>
            {lead.clientReplied && <LanePill label="Patient replied" muted />}
            {lead.needsHuman && <LanePill label="Needs staff" muted />}
            {lead.status === "booked" && <LanePill label="Booked" muted />}
          </span>
          <span className="mt-1 flex flex-wrap gap-1.5">
            <LanePill label={lead.boxName ?? "Unassigned"} />
            <LanePill label={lead.boxStage ?? lead.status} muted />
            <LanePill label={`${lead.conversationCount.toLocaleString()} messages`} muted />
          </span>
          <span className="mt-2 block text-sm leading-6 text-ink/55">
            {lead.leadSummary ?? lead.lastMessage}
          </span>
          <span className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-medium text-ink/35">
            <span>Enquiry {formatShortDate(lead.becameLeadAt)}</span>
            <span>
              {activityTimestamp(lead)
                ? `Contacted ${formatShortDate(activityTimestamp(lead))}`
                : "Not contacted yet"}
            </span>
            <span>Updated {formatShortDate(lead.lastUpdatedAt ?? lead.updatedAt)}</span>
          </span>
        </span>
      </div>
    </button>
  );
}

function ActivitySidePanel({
  leads,
  lanes,
  onSelectLead,
}: {
  leads: DentalLead[];
  lanes: NonNullable<DentalDashboardData["laneSummary"]>;
  onSelectLead: (leadId: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-[2rem] bg-white p-5 shadow-sm">
        <h3 className="font-semibold">Needs attention</h3>
        <div className="mt-4 divide-y divide-line">
          {leads.length ? leads.map((lead) => (
            <button
              key={lead.id}
              type="button"
              onClick={() => onSelectLead(lead.id)}
              className="block w-full py-3 text-left text-sm transition hover:text-pine"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="truncate font-semibold">{lead.name}</p>
                <span className="text-xs text-ink/35">{formatShortDate(lead.lastUpdatedAt ?? lead.updatedAt)}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-ink/50">{lead.leadSummary ?? lead.lastMessage}</p>
            </button>
          )) : (
            <p className="rounded-2xl bg-mist px-4 py-5 text-sm text-ink/50">No patient replies need attention.</p>
          )}
        </div>
      </div>

      <div className="rounded-[2rem] bg-white p-5 shadow-sm">
        <h3 className="font-semibold">Top lanes</h3>
        <div className="mt-4 space-y-2">
          {lanes.slice(0, 6).map((lane) => (
            <div key={lane.name} className="rounded-2xl bg-mist px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate font-semibold">{lane.name}</span>
                <span className="tabular-nums text-ink/50">{lane.total.toLocaleString()}</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-ink/40">
                <span>{lane.aiActioned.toLocaleString()} contacted</span>
                <span>{lane.needsHuman.toLocaleString()} staff</span>
                <span>{lane.booked.toLocaleString()} booked</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Activity order = when our agent last messaged them: last outbound -> actioned_at
// (matches Boxly). No ai_actioned_at/updatedAt/becameLeadAt fallback; never-contacted
// leads sort last (nulls last).
function activityTimestamp(lead: DentalLead): string | null {
  return lead.lastOutboundAt ?? lead.actionedAt ?? null;
}

function compareActivityDesc(a: string | null, b: string | null): number {
  if (a && b) return b.localeCompare(a);
  if (a) return -1;
  if (b) return 1;
  return 0;
}

const CHART_COLORS = [
  "#0b3d2e",
  "#7bb661",
  "#f4a259",
  "#e76f51",
  "#2a9d8f",
  "#577590",
  "#b5179e",
  "#3a86ff",
  "#ffbe0b",
];

function pct(part: number, total: number): number {
  if (!total) return 0;
  return Number(((part / total) * 100).toFixed(1));
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value?: number | string; name?: string; color?: string }[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line bg-white px-3 py-2 shadow-lg">
      {label != null && (
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">{label}</p>
      )}
      {payload.map((entry, index) => (
        <p key={index} className="text-sm font-bold tabular-nums" style={{ color: entry.color ?? "#0b3d2e" }}>
          {typeof entry.value === "number" ? entry.value.toLocaleString() : entry.value}
        </p>
      ))}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/40">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {sub ? <p className="mt-1 text-xs text-ink/45">{sub}</p> : null}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-[2rem] bg-white p-5 shadow-sm">
      <h3 className="text-[12px] font-semibold uppercase tracking-wider text-ink/45">{title}</h3>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function EmptyChart({ hint }: { hint: string }) {
  return (
    <div className="flex h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-mist/40 px-6 text-center">
      <p className="text-sm font-semibold text-ink/70">No data yet</p>
      <p className="mt-1 text-xs text-ink/45">{hint}</p>
    </div>
  );
}

const ANALYTICS_RANGES: [string, string][] = [
  ["all_time", "All time"],
  ["today", "Today"],
  ["last_7_days", "7 days"],
  ["last_30_days", "30 days"],
  ["last_3_months", "3 months"],
];

type AnalyticsOverride = {
  metrics: DentalDashboardData["metrics"];
  analytics: DentalDashboardData["analytics"];
};

function AnalyticsPanel({
  data,
  stats,
  practiceId,
}: {
  data: DentalDashboardData;
  stats: { total: number; aiActioned: number; needsHuman: number; booked: number };
  practiceId: string | null;
}) {
  const [range, setRange] = useState("all_time");
  const [override, setOverride] = useState<AnalyticsOverride | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);

  useEffect(() => {
    if (range === "all_time") {
      setOverride(null);
      return;
    }
    let cancelled = false;
    setRangeLoading(true);
    const params = new URLSearchParams({ range });
    if (practiceId) params.set("practiceId", practiceId);
    fetch(`/api/analytics?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((payload) => {
        if (!cancelled && payload.ok) {
          setOverride({ metrics: payload.metrics, analytics: payload.analytics });
        }
      })
      .catch(() => {
        if (!cancelled) setOverride(null);
      })
      .finally(() => {
        if (!cancelled) setRangeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range, practiceId]);

  const metrics = override?.metrics ?? data.metrics;
  const analytics = override?.analytics ?? data.analytics;

  const totalLeads = metrics?.leadTotal ?? stats.total;
  const aiActioned = metrics?.aiActionedTotal ?? stats.aiActioned;
  const responded = metrics?.clientRepliedTotal ?? 0;
  const booked = metrics?.bookedTotal ?? stats.booked;
  const urgent = metrics?.urgentTotal ?? stats.needsHuman;
  const reactivationCount = metrics?.reactivationTotal ?? 0;
  const today = metrics?.todayTotal ?? 0;

  const reactivation = analytics?.reactivation ?? { contacted: 0, responded: 0, booked: 0 };
  const needsAttention = analytics?.needsAttention ?? [];

  const treatmentData = (analytics?.treatmentBreakdown ?? [])
    .map((item) => ({ name: item.label, value: item.total }))
    .filter((item) => item.value > 0);
  const sourceData = (analytics?.sourceBreakdown ?? [])
    .map((item) => ({ name: item.source, value: item.total }))
    .filter((item) => item.value > 0);
  const sourceTotal = sourceData.reduce((sum, item) => sum + item.value, 0);
  const timelineData = (analytics?.timeline ?? []).map((item) => ({
    date: item.label,
    count: item.total,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">Dashboard</h2>
          {rangeLoading ? <span className="text-xs text-ink/40">Updating…</span> : null}
        </div>
        <div className="flex flex-wrap gap-1 rounded-full bg-mist p-1">
          {ANALYTICS_RANGES.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setRange(key)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                range === key ? "bg-pine text-lime" : "text-ink/55 hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <StatCard label="Total Leads" value={totalLeads} />
        <StatCard label="Urgent" value={urgent} sub="needs attention" />
        <StatCard label="Reactivation" value={reactivationCount} sub="campaign patients" />
        <StatCard label="AI Actioned" value={aiActioned} sub="handled by agent" />
        <StatCard label="Patients Engaged" value={responded} sub={`${pct(responded, aiActioned)}% responded`} />
        <StatCard label="Bookings Taken" value={booked} sub={`${pct(booked, responded || aiActioned)}% booked`} />
        <StatCard label="Today" value={today} sub="new today" />
      </div>

      <div className="rounded-[2rem] bg-white p-5 shadow-sm">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-ink/45">Re-activations</h3>
        <p className="mt-1 text-xs text-ink/45">Funnel for patients in the reactivation campaign.</p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { label: "AI contacted", value: reactivation.contacted, percent: null as number | null },
            { label: "Patient responded", value: reactivation.responded, percent: pct(reactivation.responded, reactivation.contacted) },
            { label: "Booked", value: reactivation.booked, percent: pct(reactivation.booked, reactivation.responded || reactivation.contacted) },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-line bg-mist/40 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">{item.label}</p>
              <div className="mt-2 flex items-baseline gap-2">
                <p className="text-2xl font-semibold tracking-tight tabular-nums">{item.value.toLocaleString()}</p>
                {item.percent !== null ? (
                  <span className="text-sm font-bold tabular-nums text-pine">{item.percent}%</span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Leads by Treatment">
          {treatmentData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={treatmentData} layout="vertical" margin={{ left: 0, right: 12 }}>
                <XAxis type="number" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis dataKey="name" type="category" width={110} fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
                <Bar dataKey="value" radius={[0, 8, 8, 0]} barSize={16}>
                  {treatmentData.map((_, index) => (
                    <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart hint="Treatment breakdown appears once leads have synced." />
          )}
        </ChartCard>

        <ChartCard title="Lead Sources">
          {sourceData.length > 0 ? (
            <div className="flex items-center gap-6">
              <div className="h-[200px] w-[200px] flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={sourceData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      innerRadius={58}
                      paddingAngle={3}
                      stroke="none"
                    >
                      {sourceData.map((_, index) => (
                        <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                {sourceData.map((entry, index) => (
                  <div key={entry.name} className="flex items-center gap-2.5 text-sm">
                    <span
                      className="h-2 w-2 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
                    />
                    <span className="truncate text-ink/80">{entry.name}</span>
                    <span className="ml-auto flex-shrink-0 font-semibold tabular-nums">
                      {entry.value.toLocaleString()}
                    </span>
                    <span className="w-[42px] flex-shrink-0 text-right text-xs tabular-nums text-ink/40">
                      {pct(entry.value, sourceTotal)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyChart hint="Source breakdown appears once matching leads are present." />
          )}
        </ChartCard>
      </div>

      {timelineData.length > 0 && (
        <ChartCard title="Leads Over Time">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={timelineData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" vertical={false} />
              <XAxis dataKey="date" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="count" stroke="#0b3d2e" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {needsAttention.length > 0 && (
        <div className="overflow-hidden rounded-[2rem] bg-white shadow-sm">
          <div className="border-b border-line px-5 py-4">
            <h3 className="text-[12px] font-semibold uppercase tracking-wider text-ink/45">Needs Attention</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink/40">
                  <th className="px-5 py-3 font-semibold">Name</th>
                  <th className="px-5 py-3 font-semibold">Phone</th>
                  <th className="px-5 py-3 font-semibold">Treatment</th>
                  <th className="px-5 py-3 font-semibold">Urgency</th>
                </tr>
              </thead>
              <tbody>
                {needsAttention.map((lead) => (
                  <tr key={lead.id} className="border-b border-line/60 last:border-0">
                    <td className="px-5 py-3 font-semibold">{lead.name}</td>
                    <td className="px-5 py-3 font-mono text-xs text-ink/55">{lead.phone ?? "—"}</td>
                    <td className="px-5 py-3 text-ink/60">{treatmentLabels[lead.treatment] ?? lead.treatment}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          (lead.urgency ?? "").toLowerCase() === "urgent"
                            ? "bg-red-50 text-red-600"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {lead.urgency ?? "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const TREATMENT_LABELS: Record<string, string> = {
  invisalign: "Invisalign",
  implants: "Dental Implants",
  full_arch_implants: "Full Arch Implants",
  composites: "Composite Bonding",
  veneers: "Veneers",
  whitening: "Teeth Whitening",
  hygiene: "Hygiene",
};

function treatmentLabel(id: string): string {
  return (
    TREATMENT_LABELS[id] ??
    id
      .split(/[_-]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function AgentPanel({
  practiceName,
  assistantName,
  openingHours,
  closingHours,
  knowledge,
  treatmentFirstMessages,
  firstMessage,
  prompt,
  saveState,
  configVersion,
  onAssistantName,
  onOpeningHours,
  onClosingHours,
  onKnowledge,
  onTreatmentFirstMessage,
  onFirstMessage,
  onPrompt,
  onRequestSave,
}: {
  practiceName: string;
  assistantName: string;
  openingHours: string;
  closingHours: string;
  knowledge: string;
  treatmentFirstMessages: Record<string, string>;
  firstMessage: string;
  prompt: string;
  saveState: string;
  configVersion: number | null;
  onAssistantName: (value: string) => void;
  onOpeningHours: (value: string) => void;
  onClosingHours: (value: string) => void;
  onKnowledge: (value: string) => void;
  onTreatmentFirstMessage: (id: string, value: string) => void;
  onFirstMessage: (value: string) => void;
  onPrompt: (value: string) => void;
  onRequestSave: () => void;
}) {
  const previewName = assistantName.trim() || "your assistant";
  const treatmentIds = Object.keys(treatmentFirstMessages);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="rounded-[2rem] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/40">Assistant</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">Edit your agent.</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-ink/50">
              Change how your assistant introduces itself, your hours, and what it knows. Saving
              creates a new approved version for {practiceName}.
            </p>
          </div>
          {configVersion ? (
            <span className="rounded-full bg-mist px-3 py-1 text-xs font-semibold text-ink/55">
              v{configVersion}
            </span>
          ) : null}
        </div>

        <label className="mt-5 block text-sm font-semibold">Assistant name</label>
        <p className="mt-1 text-xs text-ink/45">The name patients see, e.g. &ldquo;Emily&rdquo;.</p>
        <input
          value={assistantName}
          onChange={(event) => onAssistantName(event.target.value)}
          placeholder="Emily"
          className="mt-2 w-full rounded-2xl border border-line bg-mist/50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-lime"
        />

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-semibold">Opening hours</label>
            <input
              value={openingHours}
              onChange={(event) => onOpeningHours(event.target.value)}
              placeholder="Mon-Fri 9:00"
              className="mt-2 w-full rounded-2xl border border-line bg-mist/50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-lime"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold">Closing hours</label>
            <input
              value={closingHours}
              onChange={(event) => onClosingHours(event.target.value)}
              placeholder="Mon-Fri 17:30"
              className="mt-2 w-full rounded-2xl border border-line bg-mist/50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-lime"
            />
          </div>
        </div>

        <label className="mt-5 block text-sm font-semibold">First WhatsApp message</label>
        <textarea
          value={firstMessage}
          onChange={(event) => onFirstMessage(event.target.value)}
          className="mt-2 min-h-24 w-full rounded-2xl border border-line bg-mist/50 p-4 text-sm outline-none focus:ring-2 focus:ring-lime"
        />

        <label className="mt-5 block text-sm font-semibold">Practice knowledge</label>
        <p className="mt-1 text-xs text-ink/45">
          Treatments, prices, address, parking, FAQs the assistant can mention.
        </p>
        <textarea
          value={knowledge}
          onChange={(event) => onKnowledge(event.target.value)}
          placeholder="e.g. Invisalign from £2,500. 2A Regent Road, LS29 9EA. Limited free parking outside."
          className="mt-2 min-h-32 w-full rounded-2xl border border-line bg-mist/50 p-4 text-sm leading-6 outline-none focus:ring-2 focus:ring-lime"
        />

        {treatmentIds.length > 0 && (
          <div className="mt-5">
            <p className="text-sm font-semibold">First message per treatment</p>
            <p className="mt-1 text-xs text-ink/45">
              The opening message when a patient enquires about a specific treatment. Leave blank to
              use the default.
            </p>
            <div className="mt-3 space-y-3">
              {treatmentIds.map((id) => (
                <div key={id}>
                  <label className="block text-xs font-semibold text-ink/55">
                    {treatmentLabel(id)}
                  </label>
                  <textarea
                    value={treatmentFirstMessages[id] ?? ""}
                    onChange={(event) => onTreatmentFirstMessage(id, event.target.value)}
                    className="mt-1 min-h-20 w-full rounded-2xl border border-line bg-mist/50 p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-lime"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <details className="mt-5 rounded-2xl border border-line bg-mist/30 p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            Advanced: assistant guidance (master prompt)
          </summary>
          <textarea
            value={prompt}
            onChange={(event) => onPrompt(event.target.value)}
            className="mt-3 min-h-72 w-full rounded-2xl border border-line bg-white p-4 font-mono text-xs leading-6 outline-none focus:ring-2 focus:ring-lime"
          />
        </details>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            onClick={onRequestSave}
            disabled={saveState === "saving"}
            className="rounded-full bg-pine px-6 py-3 text-sm font-semibold text-lime transition hover:brightness-110 disabled:opacity-50"
          >
            {saveState === "saving" ? "Saving..." : "Save & approve"}
          </button>
          {saveState === "saved" && (
            <span className="text-sm font-semibold text-pine">Saved. New version is live-ready.</span>
          )}
          {saveState === "error" && (
            <span className="text-sm font-semibold text-red-600">Could not save. Try again.</span>
          )}
        </div>
      </div>

      <div className="rounded-[2rem] bg-white p-5 shadow-sm">
        <h3 className="font-semibold">Test preview</h3>
        <div className="mt-4 rounded-[1.5rem] bg-[#eee9e1] p-4">
          <div className="rounded-2xl rounded-br-sm bg-[#d9fdd3] px-4 py-3 text-sm shadow-sm">
            {firstMessage}
          </div>
          <div className="mt-3 rounded-2xl rounded-bl-sm bg-white px-4 py-3 text-sm shadow-sm">
            Is this treatment suitable for me?
          </div>
          <div className="mt-3 rounded-2xl rounded-br-sm bg-[#d9fdd3] px-4 py-3 text-sm shadow-sm">
            Thanks for asking. {previewName} can explain the consultation process and check a suitable
            appointment, but the dentist will confirm clinical suitability.
          </div>
        </div>
        <p className="mt-4 text-xs leading-5 text-ink/45">
          This is a static preview. Your saved changes apply to new WhatsApp conversations once the
          automation is connected to this config.
        </p>
      </div>
    </div>
  );
}

function ConfirmSaveDialog({
  practiceName,
  busy,
  onConfirm,
  onCancel,
}: {
  practiceName: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cancel"
        onClick={onCancel}
        className="absolute inset-0 bg-pine-deep/40 backdrop-blur-[2px]"
      />
      <div className="relative w-full max-w-md rounded-[2rem] bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-semibold">Approve agent changes?</h3>
        <p className="mt-2 text-sm leading-6 text-ink/60">
          This saves a new approved version of the agent config for {practiceName}. Once the
          automation reads it, changes apply to new conversations. Existing chats are not affected.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-full bg-mist px-5 py-2.5 text-sm font-semibold text-ink/60 transition hover:text-ink disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-full bg-pine px-5 py-2.5 text-sm font-semibold text-lime transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Saving..." : "Approve & save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConnectPanel({
  data,
  provisioning,
  onProvision,
}: {
  data: DentalDashboardData;
  provisioning: boolean;
  onProvision: () => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-[2rem] bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Connections</h2>
        <div className="mt-4 space-y-3">
          {data.integrations.map((integration) => (
            <div key={integration.id} className="rounded-2xl border border-line p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{integration.displayName}</p>
                  <p className="mt-1 text-sm text-ink/50">{integration.healthLabel}</p>
                </div>
                <LanePill label={integration.status} muted={integration.status !== "connected"} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-[2rem] bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Automation setup</h2>
        <p className="mt-2 text-sm leading-6 text-ink/55">
          Prepare the follow-up and booking automations for this practice. Nothing goes live until you approve it.
        </p>
        <button
          onClick={onProvision}
          disabled={provisioning}
          className="mt-4 rounded-full bg-pine px-6 py-3 text-sm font-semibold text-lime transition hover:brightness-110 disabled:opacity-50"
        >
          {provisioning ? "Preparing..." : "Prepare automations"}
        </button>
        <div className="mt-4 space-y-2">
          {data.workflows.length ? (
            data.workflows.map((workflow) => (
              <div key={workflow.id} className="rounded-2xl bg-mist px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold">{workflow.displayName}</span>
                  <span className="text-ink/50">{workflow.active ? "Live" : "Not live"}</span>
                </div>
                <p className="mt-1 text-xs text-ink/45">{workflow.launchReady ? "Ready to review" : "Needs review"}</p>
              </div>
            ))
          ) : (
            <p className="rounded-2xl bg-mist px-4 py-5 text-sm text-ink/50">
              No automations prepared yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function LanePill({ label, muted = false }: { label: string; muted?: boolean }) {
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${
        muted ? "bg-ink/5 text-ink/55" : "bg-lime text-pine-deep"
      }`}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}

function Detail({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/35">{label}</p>
      <p className="mt-1 text-ink/70">{value}</p>
    </div>
  );
}

function formatDateTime(value?: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatShortDate(value?: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
}

function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildStats(leads: DentalLead[], metrics?: DentalDashboardData["metrics"]) {
  return {
    total: metrics?.leadTotal ?? leads.length,
    aiActioned:
      metrics?.aiActionedTotal ??
      leads.filter((lead) => lead.aiActioned || lead.messages.some((message) => message.aiGenerated)).length,
    needsHuman: metrics?.needsHumanTotal ?? leads.filter((lead) => lead.needsHuman).length,
    booked: metrics?.bookedTotal ?? leads.filter((lead) => lead.status === "booked").length,
  };
}

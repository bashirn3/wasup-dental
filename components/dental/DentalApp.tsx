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
import BoxlyConfigPanel from "@/components/dental/BoxlyConfigPanel";
import { MIcon } from "@/components/mot/icons";
import { defaultAgentPrompt, defaultFirstMessage, treatmentLabels } from "@/lib/dental-demo-data";
import type { DentalDashboardData, DentalLead, DentalMessage } from "@/lib/dental-types";
import {
  DENTAL_TREATMENTS,
  treatmentLabel,
  emptyMisc,
  emptyTemplate,
  emptyTreatmentFacts,
  type FirstMessageTemplate,
  type MiscInfo,
  type TreatmentFacts,
} from "@/lib/agent-editable";

type TabKey = "dashboard" | "leads" | "activity" | "agent" | "config" | "connect";
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
  ["config", "Config", MIcon.bolt],
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
  const [treatmentTemplates, setTreatmentTemplates] = useState<Record<string, FirstMessageTemplate>>({});
  const [treatmentFacts, setTreatmentFacts] = useState<Record<string, TreatmentFacts>>({});
  const [misc, setMisc] = useState<MiscInfo>(emptyMisc());
  const [otherMenuItems, setOtherMenuItems] = useState("");
  const [configVersion, setConfigVersion] = useState<number | null>(null);
  const [confirmSave, setConfirmSave] = useState(false);
  const [leadFilters, setLeadFilters] = useState<LeadFilters>(emptyFilters);
  const [page, setPage] = useState(1);
  const [savedSnapshot, setSavedSnapshot] = useState({
    firstMessage: defaultFirstMessage,
    prompt: defaultAgentPrompt,
    assistantName: "",
    openingHours: "",
    closingHours: "",
    knowledge: "",
    otherMenuItems: "",
    treatmentFirstMessages: {} as Record<string, string>,
    treatmentTemplates: {} as Record<string, FirstMessageTemplate>,
    treatmentFacts: {} as Record<string, TreatmentFacts>,
    misc: emptyMisc() as MiscInfo,
  });
  const [chatMessages, setChatMessages] = useState<DentalMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [activePracticeId, setActivePracticeId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(ACTIVE_WORKSPACE_KEY);
  });

  const load = useCallback(async () => {
    const offset = (page - 1) * PAGE_SIZE;
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
      setData(payload);
      if (payload.practiceId && payload.practiceId !== activePracticeId) {
        setActivePracticeId(payload.practiceId);
        window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, payload.practiceId);
      }
    } finally {
      setLoading(false);
    }
  }, [activePracticeId, leadFilters, page]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const loadConfig = useCallback(async () => {
      const params = new URLSearchParams();
      if (activePracticeId) params.set("practiceId", activePracticeId);
      const res = await fetch(`/api/agent-config?${params.toString()}`, { cache: "no-store" });
      const payload = await res.json().catch(() => ({}));
      if (payload.config) {
        const editable = payload.config.clientEditable ?? {};
        const asStringRecord = (value: unknown): Record<string, string> =>
          value && typeof value === "object" ? (value as Record<string, string>) : {};
        const loaded = {
          firstMessage: payload.config.firstMessage ?? defaultFirstMessage,
          prompt: payload.config.prompt ?? defaultAgentPrompt,
          assistantName: editable.assistantName ?? "",
          openingHours: editable.openingHours ?? "",
          closingHours: editable.closingHours ?? "",
          knowledge: editable.knowledge ?? "",
          otherMenuItems: editable.otherMenuItems ?? "",
          treatmentFirstMessages: asStringRecord(editable.treatmentFirstMessages),
          treatmentTemplates: (editable.treatmentTemplates ?? {}) as Record<string, FirstMessageTemplate>,
          treatmentFacts: (editable.treatmentFacts ?? {}) as Record<string, TreatmentFacts>,
          misc: { ...emptyMisc(), ...(editable.misc ?? {}) } as MiscInfo,
        };
        setFirstMessage(loaded.firstMessage);
        setPrompt(loaded.prompt);
        setAssistantName(loaded.assistantName);
        setOpeningHours(loaded.openingHours);
        setClosingHours(loaded.closingHours);
        setKnowledge(loaded.knowledge);
        setOtherMenuItems(loaded.otherMenuItems);
        setTreatmentFirstMessages(loaded.treatmentFirstMessages);
        setTreatmentTemplates(loaded.treatmentTemplates);
        setTreatmentFacts(loaded.treatmentFacts);
        setMisc(loaded.misc);
        setSavedSnapshot(loaded);
        setConfigVersion(
          typeof payload.config.versionNumber === "number" ? payload.config.versionNumber : null,
        );
      }
  }, [activePracticeId]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const leads = useMemo(() => data?.leads ?? [], [data]);
  const workspaces = data?.workspaces ?? [];
  const selectedLead = useMemo(
    () =>
      [...leads, ...(data?.activityLeads ?? [])].find((lead) => lead.id === selectedLeadId) ?? null,
    [data?.activityLeads, leads, selectedLeadId],
  );
  const stats = useMemo(() => buildStats(leads, data?.metrics), [leads, data?.metrics]);
  const agentDirty = useMemo(
    () =>
      firstMessage !== savedSnapshot.firstMessage ||
      prompt !== savedSnapshot.prompt ||
      assistantName !== savedSnapshot.assistantName ||
      openingHours !== savedSnapshot.openingHours ||
      closingHours !== savedSnapshot.closingHours ||
      knowledge !== savedSnapshot.knowledge ||
      otherMenuItems !== savedSnapshot.otherMenuItems ||
      JSON.stringify(treatmentFirstMessages) !== JSON.stringify(savedSnapshot.treatmentFirstMessages) ||
      JSON.stringify(treatmentTemplates) !== JSON.stringify(savedSnapshot.treatmentTemplates) ||
      JSON.stringify(treatmentFacts) !== JSON.stringify(savedSnapshot.treatmentFacts) ||
      JSON.stringify(misc) !== JSON.stringify(savedSnapshot.misc),
    [
      firstMessage,
      prompt,
      assistantName,
      openingHours,
      closingHours,
      knowledge,
      otherMenuItems,
      treatmentFirstMessages,
      treatmentTemplates,
      treatmentFacts,
      misc,
      savedSnapshot,
    ],
  );

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
          otherMenuItems,
          misc,
          treatmentFirstMessages,
          treatmentTemplates,
          treatmentFacts,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (res.ok) {
        if (typeof payload.config?.versionNumber === "number") {
          setConfigVersion(payload.config.versionNumber);
        }
        setSavedSnapshot({
          firstMessage,
          prompt,
          assistantName,
          openingHours,
          closingHours,
          knowledge,
          otherMenuItems,
          treatmentFirstMessages,
          treatmentTemplates,
          treatmentFacts,
          misc,
        });
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
          {(data as { signedInEmail?: string | null })?.signedInEmail && (
            <p className="mt-2 text-sm font-medium text-ink/70">
              Signed in as {(data as { signedInEmail?: string | null }).signedInEmail}
            </p>
          )}
          <p className="mt-2 text-sm leading-6 text-ink/55">
            This account is not connected to a dental practice yet. Make sure you signed in with the
            email your admin invited, ask an admin to invite this address, or start a new practice
            setup.
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
                    setPage(1);
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
              page={page}
              pageSize={PAGE_SIZE}
              onPageChange={(next) => {
                setSelectedLeadId(null);
                setPage(next);
                setLoading(true);
              }}
              onFiltersChange={(filters) => {
                setSelectedLeadId(null);
                setLeadFilters(filters);
                setPage(1);
                setLoading(true);
              }}
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
              practiceId={data.practiceId ?? null}
              assistantName={assistantName}
              openingHours={openingHours}
              closingHours={closingHours}
              knowledge={knowledge}
              otherMenuItems={otherMenuItems}
              misc={misc}
              treatmentFirstMessages={treatmentFirstMessages}
              treatmentTemplates={treatmentTemplates}
              treatmentFacts={treatmentFacts}
              firstMessage={firstMessage}
              prompt={prompt}
              saveState={saveState}
              configVersion={configVersion}
              dirty={agentDirty}
              onAssistantName={setAssistantName}
              onOpeningHours={setOpeningHours}
              onClosingHours={setClosingHours}
              onKnowledge={setKnowledge}
              onOtherMenuItems={setOtherMenuItems}
              onMisc={(patch) => setMisc((prev) => ({ ...prev, ...patch }))}
              onTreatmentFirstMessage={(id, value) =>
                setTreatmentFirstMessages((prev) => ({ ...prev, [id]: value }))
              }
              onTreatmentTemplate={(id, patch) =>
                setTreatmentTemplates((prev) => ({
                  ...prev,
                  [id]: { ...emptyTemplate(), ...prev[id], ...patch },
                }))
              }
              onTreatmentFacts={(id, patch) =>
                setTreatmentFacts((prev) => ({
                  ...prev,
                  [id]: { ...emptyTreatmentFacts(), ...prev[id], ...patch },
                }))
              }
              onFirstMessage={setFirstMessage}
              onPrompt={setPrompt}
              onRequestSave={() => setConfirmSave(true)}
              onReloadConfig={loadConfig}
            />
          )}
          {tab === "config" && (
            <BoxlyConfigPanel
              practiceId={data.practiceId ?? null}
              practiceName={data.practice?.name ?? "your practice"}
              clientControls={(data.practice?.name ?? "").toLowerCase().includes("regent")}
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
        <div className="grid grid-cols-6 gap-1">
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

function LeadsPanel({
  leads,
  selectedLead,
  totalLeads,
  filteredTotal,
  facets,
  filters,
  page,
  pageSize,
  onPageChange,
  onFiltersChange,
  onSelect,
}: {
  leads: DentalLead[];
  selectedLead: DentalLead | null;
  totalLeads: number;
  filteredTotal: number;
  facets?: DentalDashboardData["facets"];
  filters: LeadFilters;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onFiltersChange: (filters: LeadFilters) => void;
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
            placeholder="All Status"
            value={filters.status}
            options={facets?.statuses ?? []}
            onChange={(value) => onFiltersChange({ ...filters, status: value })}
          />
          <FilterSelect
            label="Boxes"
            placeholder="All Boxes"
            value={filters.box}
            options={facets?.boxes ?? []}
            onChange={(value) => onFiltersChange({ ...filters, box: value })}
          />
          <FilterSelect
            label="Stages"
            placeholder="All Stages"
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
      {(filtered ? filteredTotal : totalLeads) > pageSize && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={filtered ? filteredTotal : totalLeads}
          onPageChange={onPageChange}
        />
      )}
    </div>
  );
}

function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = total ? (safePage - 1) * pageSize + 1 : 0;
  const end = Math.min(safePage * pageSize, total);

  return (
    <div className="flex flex-col gap-3 border-t border-line px-5 py-4 text-sm text-ink/55 sm:flex-row sm:items-center sm:justify-between">
      <p>
        Showing <span className="font-semibold text-ink">{start.toLocaleString()}</span>–
        <span className="font-semibold text-ink">{end.toLocaleString()}</span> of{" "}
        <span className="font-semibold text-ink">{total.toLocaleString()}</span>
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(safePage - 1)}
          disabled={safePage <= 1}
          className="inline-flex h-9 items-center gap-1 rounded-full border border-line bg-white px-3 text-xs font-semibold text-pine transition hover:border-pine disabled:cursor-not-allowed disabled:text-ink/35 disabled:opacity-60"
        >
          <MIcon.back size={14} />
          Prev
        </button>
        <span className="min-w-[64px] text-center text-xs font-semibold tabular-nums text-ink">
          {safePage} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(safePage + 1)}
          disabled={safePage >= totalPages}
          className="inline-flex h-9 items-center gap-1 rounded-full border border-line bg-white px-3 text-xs font-semibold text-pine transition hover:border-pine disabled:cursor-not-allowed disabled:text-ink/35 disabled:opacity-60"
        >
          Next
          <MIcon.chev size={14} />
        </button>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-line bg-mist/50 px-4 py-3 text-sm outline-none transition focus:border-pine/30 focus:bg-white"
      >
        <option value="">{placeholder ?? `All ${label}`}</option>
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
                sortedMessages.map((message) => {
                  const isOutbound = message.direction === "outbound";
                  const isSystem = message.kind === "system";

                  if (isSystem) {
                    return (
                      <div key={message.id} className="mx-auto max-w-[90%] rounded-2xl bg-black/[0.05] px-3 py-2 text-center">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">
                          {message.sender ?? "System"} · {formatDateTime(message.createdAt)}
                        </p>
                        <p className="mt-0.5 whitespace-pre-wrap text-xs text-ink/55">{message.body}</p>
                      </div>
                    );
                  }

                  const roleLabel = isOutbound
                    ? message.sender ?? (message.aiGenerated ? "Assistant" : "Team")
                    : message.sender ?? "Client";

                  return (
                    <div
                      key={message.id}
                      className={`max-w-[86%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                        isOutbound ? "ml-auto rounded-br-sm bg-[#d9fdd3]" : "rounded-bl-sm bg-white"
                      }`}
                    >
                      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
                        <span className={isOutbound ? "text-emerald-700" : "text-sky-700"}>{roleLabel}</span>
                        {isOutbound && message.aiGenerated && (
                          <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] leading-none text-emerald-700">
                            AI
                          </span>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap">{message.body}</p>
                      <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-ink/35">
                        {formatDateTime(message.createdAt)}
                      </p>
                    </div>
                  );
                })
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
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
  }, [filters]);
  const metrics = data.metrics;
  const total = Math.max(metrics?.leadTotal ?? data.leads.length, 1);
  const sourceLeads = data.activityLeads?.length ? data.activityLeads : data.leads;
  const activityLeads = sourceLeads
    .filter((lead) => lead.aiActioned || lead.actioned || lead.clientReplied || lead.needsHuman || lead.status === "booked")
    .filter((lead) => {
      const search = filters.q.trim().toLowerCase();
      const statusMatches =
        !filters.status ||
        (filters.status === "AI responded" && (lead.aiActioned || lead.actioned)) ||
        (filters.status === "Client responded" && lead.clientReplied) ||
        (filters.status === "Booked" && lead.status === "booked");
      const laneMatches = !filters.box || lead.boxName === filters.box;
      const searchMatches =
        !search ||
        [lead.name, lead.phone, lead.email, lead.boxName, lead.boxStage, lead.leadSummary, lead.lastMessage]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search));

      return statusMatches && laneMatches && searchMatches;
    })
    .sort((a, b) => compareActivityDesc(activityTimestamp(a), activityTimestamp(b)));
  const ACTIVITY_PAGE_SIZE = 20;
  const pagedActivityLeads = activityLeads.slice(
    (page - 1) * ACTIVITY_PAGE_SIZE,
    page * ACTIVITY_PAGE_SIZE,
  );
  const statusOptions = ["AI responded", "Client responded", "Booked"];
  const hasFilters = filters.q || filters.status || filters.box;
  const totalActioned =
    metrics?.aiActionedTotal ?? sourceLeads.filter((lead) => lead.aiActioned || lead.actioned).length;
  const clientResponded =
    metrics?.clientRepliedTotal ?? sourceLeads.filter((lead) => lead.clientReplied).length;
  const engagementCards = [
    {
      label: "Total Actioned",
      value: totalActioned,
      detail: `${Math.round((totalActioned / total) * 100)}% of leads`,
    },
    {
      label: "AI Responded",
      value: totalActioned,
      detail: "Agent first messages sent",
    },
    {
      label: "Client Responded",
      value: clientResponded,
      detail: "Replies to review",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-[2rem] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/40">Activity</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">Conversation activity.</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/50">
              Track actioned leads, agent responses, client replies, and bookings.
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
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {engagementCards.map((card) => (
            <div key={card.label} className="rounded-2xl bg-mist/70 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/40">{card.label}</p>
              <p className="mt-2 text-3xl font-semibold tracking-tight">{card.value.toLocaleString()}</p>
              <p className="mt-1 text-xs text-ink/45">{card.detail}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
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
                placeholder="All Status"
                value={filters.status}
                options={statusOptions}
                onChange={(value) => setFilters((current) => ({ ...current, status: value }))}
              />
              <FilterSelect
                label="Boxes"
                placeholder="All Boxes"
                value={filters.box}
                options={data.facets?.boxes ?? []}
                onChange={(value) => setFilters((current) => ({ ...current, box: value }))}
              />
            </div>
          </div>
          <div className="divide-y divide-line">
            {pagedActivityLeads.length ? pagedActivityLeads.map((lead) => (
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
          {activityLeads.length > ACTIVITY_PAGE_SIZE && (
            <Pagination
              page={page}
              pageSize={ACTIVITY_PAGE_SIZE}
              total={activityLeads.length}
              onPageChange={setPage}
            />
          )}
        </div>
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
  const urgent = metrics?.urgentTotal ?? stats.needsHuman;
  const today = metrics?.todayTotal ?? 0;

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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Total Leads" value={totalLeads} />
        <StatCard label="Urgent" value={urgent} sub="needs attention" />
        <StatCard label="AI Actioned" value={aiActioned} sub="handled by agent" />
        <StatCard label="Patients Engaged" value={responded} sub={`${pct(responded, aiActioned)}% responded`} />
        <StatCard label="Today" value={today} sub="new today" />
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

type SimMessage = { id: string; role: "assistant" | "patient"; content: string };

type AgentVersion = {
  id: string;
  versionNumber: number;
  isActive: boolean;
  promptPreview: string;
  firstMessagePreview: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

// The production Regent prompt replies as {"response":"..."} JSON; unwrap it so the
// simulator shows plain WhatsApp text instead of raw JSON.
function extractReplyText(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  const tryParse = (value: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  let obj = tryParse(text);
  if (!obj) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) obj = tryParse(match[0]);
  }
  if (obj) {
    const value = obj.response ?? obj.message ?? obj.reply;
    if (typeof value === "string" && value.trim()) return value;
  }
  return text;
}
function LabeledLines({
  label,
  hint,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string[];
  placeholder?: string;
  onChange: (value: string[]) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-semibold">{label}</label>
      {hint ? <p className="mt-1 text-xs text-ink/45">{hint}</p> : null}
      <textarea
        value={value.join("\n")}
        onChange={(event) => onChange(event.target.value.split("\n"))}
        placeholder={placeholder}
        className="mt-2 min-h-20 w-full rounded-2xl border border-line bg-mist/50 p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-lime"
      />
      <p className="mt-1 text-[11px] text-ink/40">One per line.</p>
    </div>
  );
}

function AgentPanel({
  practiceName,
  practiceId,
  assistantName,
  openingHours,
  closingHours,
  knowledge,
  otherMenuItems,
  misc,
  treatmentFirstMessages,
  treatmentTemplates,
  treatmentFacts,
  firstMessage,
  prompt,
  saveState,
  configVersion,
  dirty,
  onAssistantName,
  onOpeningHours,
  onClosingHours,
  onKnowledge,
  onOtherMenuItems,
  onMisc,
  onTreatmentFirstMessage,
  onTreatmentTemplate,
  onTreatmentFacts,
  onFirstMessage,
  onPrompt,
  onRequestSave,
  onReloadConfig,
}: {
  practiceName: string;
  practiceId: string | null;
  assistantName: string;
  openingHours: string;
  closingHours: string;
  knowledge: string;
  otherMenuItems: string;
  misc: MiscInfo;
  treatmentFirstMessages: Record<string, string>;
  treatmentTemplates: Record<string, FirstMessageTemplate>;
  treatmentFacts: Record<string, TreatmentFacts>;
  firstMessage: string;
  prompt: string;
  saveState: string;
  configVersion: number | null;
  dirty: boolean;
  onAssistantName: (value: string) => void;
  onOpeningHours: (value: string) => void;
  onClosingHours: (value: string) => void;
  onKnowledge: (value: string) => void;
  onOtherMenuItems: (value: string) => void;
  onMisc: (patch: Partial<MiscInfo>) => void;
  onTreatmentFirstMessage: (id: string, value: string) => void;
  onTreatmentTemplate: (id: string, patch: Partial<FirstMessageTemplate>) => void;
  onTreatmentFacts: (id: string, patch: Partial<TreatmentFacts>) => void;
  onFirstMessage: (value: string) => void;
  onPrompt: (value: string) => void;
  onRequestSave: () => void;
  onReloadConfig: () => Promise<void> | void;
}) {
  const displayName = assistantName.trim() || "your assistant";
  const treatmentOptions = DENTAL_TREATMENTS as readonly string[];
  const promptWordCount = prompt.trim().split(/\s+/).filter(Boolean).length;

  const [firstMessageOpen, setFirstMessageOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [firstMessageLocked, setFirstMessageLocked] = useState(false);
  const [instructionPatch, setInstructionPatch] = useState("");
  const [selectedTreatment, setSelectedTreatment] = useState(treatmentOptions[0] ?? "invisalign");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [scan, setScan] = useState<{
    status: "idle" | "scanning" | "done" | "error";
    message?: string;
  }>({ status: "idle" });

  const facts = treatmentFacts[selectedTreatment] ?? emptyTreatmentFacts();
  const template = treatmentTemplates[selectedTreatment] ?? emptyTemplate();

  async function scanWebsite() {
    if (!websiteUrl.trim()) return;
    setScan({ status: "scanning" });
    try {
      const res = await fetch("/api/knowledge/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ practiceId, websiteUrl, treatment: selectedTreatment }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setScan({ status: "error", message: payload.error ?? "Website scan failed." });
        return;
      }
      const k = (payload.knowledge ?? {}) as Partial<TreatmentFacts> & {
        finance?: string;
        consultationCta?: string;
      };
      // Merge scraped facts into the editable card for this treatment.
      onTreatmentFacts(selectedTreatment, {
        generalInfo: typeof k.generalInfo === "string" ? k.generalInfo : facts.generalInfo,
        benefits: Array.isArray(k.benefits) ? k.benefits : facts.benefits,
        suitability: Array.isArray(k.suitability) ? k.suitability : facts.suitability,
        process: Array.isArray(k.process) ? k.process : facts.process,
        pricing: typeof k.pricing === "string" ? k.pricing : facts.pricing,
        financeOffering:
          typeof k.financeOffering === "string"
            ? k.financeOffering
            : typeof k.finance === "string"
              ? k.finance
              : facts.financeOffering,
        pricingOffers: Array.isArray(k.pricingOffers) ? k.pricingOffers : facts.pricingOffers,
        contraindications: Array.isArray(k.contraindications)
          ? k.contraindications
          : facts.contraindications,
        confidence: typeof k.confidence === "number" ? k.confidence : facts.confidence,
      });
      setScan({
        status: "done",
        message: payload.persisted
          ? "Scanned and merged into the fact cards below."
          : "Scanned into the fact cards below. Save to persist.",
      });
    } catch {
      setScan({ status: "error", message: "Scan endpoint is not reachable." });
    }
  }

  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<AgentVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);

  const loadVersions = useCallback(async () => {
    setVersionsLoading(true);
    try {
      const params = new URLSearchParams();
      if (practiceId) params.set("practiceId", practiceId);
      const res = await fetch(`/api/agent-config/versions?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = await res.json().catch(() => ({}));
      setVersions(Array.isArray(payload.versions) ? payload.versions : []);
    } finally {
      setVersionsLoading(false);
    }
  }, [practiceId]);

  function openVersions() {
    setVersionsOpen(true);
    void loadVersions();
  }

  async function activateVersion(versionId: string) {
    setActivatingId(versionId);
    try {
      const res = await fetch("/api/agent-config/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ practiceId, versionId }),
      });
      if (res.ok) {
        await onReloadConfig();
        await loadVersions();
      }
    } finally {
      setActivatingId(null);
    }
  }

  const [simMessages, setSimMessages] = useState<SimMessage[]>([
    { id: "sim-opening", role: "assistant", content: firstMessage },
  ]);
  const [draft, setDraft] = useState("");
  const [simSeq, setSimSeq] = useState(0);
  const [simBusy, setSimBusy] = useState(false);

  function buildSystemPrompt(): string {
    const lines: string[] = [];
    if (prompt.trim()) lines.push(prompt.trim());
    if (assistantName.trim()) {
      lines.push(
        `Your name is ${assistantName.trim()}. Always introduce yourself as ${assistantName.trim()} from ${practiceName}.`,
      );
    }
    if (openingHours.trim() || closingHours.trim()) {
      lines.push(
        `Practice hours: ${[openingHours.trim(), closingHours.trim()].filter(Boolean).join(" — ")}.`,
      );
    }
    if (knowledge.trim()) lines.push(`Practice knowledge you may use:\n${knowledge.trim()}`);

    const miscBits: string[] = [];
    if (misc.address.trim()) miscBits.push(`Address: ${misc.address.trim()}`);
    if (misc.phone.trim()) miscBits.push(`Phone: ${misc.phone.trim()}`);
    if (misc.parking.trim()) miscBits.push(`Parking: ${misc.parking.trim()}`);
    if (misc.notes.trim()) miscBits.push(`Notes: ${misc.notes.trim()}`);
    if (miscBits.length) lines.push(`Practice details:\n${miscBits.join("\n")}`);

    // Structured fact card for the treatment currently being tested.
    const f = treatmentFacts[selectedTreatment];
    if (f) {
      const factBits: string[] = [];
      if (f.generalInfo.trim()) factBits.push(f.generalInfo.trim());
      if (f.benefits.length) factBits.push(`Benefits: ${f.benefits.join("; ")}`);
      if (f.suitability.length) factBits.push(`Suitable for: ${f.suitability.join("; ")}`);
      if (f.process.length) factBits.push(`Process: ${f.process.join("; ")}`);
      if (f.pricing.trim()) factBits.push(`Pricing: ${f.pricing.trim()}`);
      if (f.financeOffering.trim()) factBits.push(`Finance: ${f.financeOffering.trim()}`);
      if (f.pricingOffers.length) factBits.push(`Current offers: ${f.pricingOffers.join("; ")}`);
      if (f.contraindications.length)
        factBits.push(`Never claim / do not say: ${f.contraindications.join("; ")}`);
      if (f.faqs.length)
        factBits.push(
          `FAQs:\n${f.faqs.map((q) => `Q: ${q.question}\nA: ${q.answer}`).join("\n")}`,
        );
      if (factBits.length)
        lines.push(
          `Approved facts for ${treatmentLabel(selectedTreatment)} (use only these, never invent):\n${factBits.join("\n")}`,
        );
    }

    if (otherMenuItems.trim()) lines.push(`Other treatments you may mention briefly:\n${otherMenuItems.trim()}`);

    const opener = treatmentFirstMessages[selectedTreatment]?.trim();
    if (opener) lines.push(`For ${treatmentLabel(selectedTreatment)} enquiries your opening style is: "${opener}"`);
    lines.push(
      `You are in a private test simulator for ${practiceName}. Reply as the WhatsApp assistant would: warm, concise, one question at a time. Never diagnose, quote unconfirmed prices, or guarantee outcomes.`,
    );
    return lines.join("\n\n");
  }

  async function sendSim() {
    const clean = draft.trim();
    if (!clean || simBusy) return;
    const seq = simSeq + 1;
    setSimSeq(seq);
    const history: SimMessage[] = [...simMessages, { id: `patient-${seq}`, role: "patient", content: clean }];
    setSimMessages(history);
    setDraft("");
    setSimBusy(true);
    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt: buildSystemPrompt(),
          messages: history.map((m) => ({
            role: m.role === "patient" ? "user" : "assistant",
            content: m.content,
          })),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      const reply =
        res.ok && payload.reply
          ? extractReplyText(payload.reply)
          : "⚠️ Could not generate a reply. Check the AI configuration.";
      setSimMessages((current) => [...current, { id: `assistant-${seq}`, role: "assistant", content: reply }]);
    } catch {
      setSimMessages((current) => [
        ...current,
        { id: `assistant-${seq}`, role: "assistant", content: "⚠️ Could not reach the agent service." },
      ]);
    } finally {
      setSimBusy(false);
    }
  }

  function restartSim() {
    setSimSeq(0);
    setSimBusy(false);
    setSimMessages([{ id: "sim-opening", role: "assistant", content: firstMessage }]);
    setDraft("");
  }

  function injectInstructions() {
    const clean = instructionPatch.trim();
    if (!clean) return;
    onPrompt(`${prompt.trim()}\n\nAdditional dashboard instruction:\n${clean}`);
    setInstructionPatch("");
    setPromptOpen(true);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_390px]">
      {versionsOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/30 backdrop-blur-sm">
          <button
            type="button"
            aria-label="Close version history"
            onClick={() => setVersionsOpen(false)}
            className="flex-1"
          />
          <div className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/40">History</p>
                <h3 className="mt-1 text-lg font-semibold">Prompt versions</h3>
              </div>
              <button
                type="button"
                onClick={() => setVersionsOpen(false)}
                className="text-ink/40 transition hover:text-pine"
                aria-label="Close"
              >
                <MIcon.close size={20} />
              </button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {versionsLoading ? (
                <p className="text-sm text-ink/45">Loading versions…</p>
              ) : versions.length === 0 ? (
                <p className="text-sm text-ink/45">No saved versions yet.</p>
              ) : (
                versions.map((version) => (
                  <div
                    key={version.id}
                    className={`rounded-2xl border p-4 ${
                      version.isActive ? "border-pine bg-pine/5" : "border-line bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">v{version.versionNumber}</span>
                        {version.isActive ? (
                          <span className="rounded-full bg-lime px-2.5 py-0.5 text-[11px] font-semibold text-pine-deep">
                            Active
                          </span>
                        ) : null}
                      </div>
                      {version.isActive ? (
                        <span className="text-xs text-ink/40">Live</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => activateVersion(version.id)}
                          disabled={activatingId === version.id}
                          className="rounded-full border border-pine px-3 py-1.5 text-xs font-semibold text-pine transition hover:bg-pine/5 disabled:opacity-50"
                        >
                          {activatingId === version.id ? "Activating…" : "Make active"}
                        </button>
                      )}
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-ink/60">
                      {version.promptPreview || "No prompt text."}
                    </p>
                    <p className="mt-2 text-[11px] text-ink/40">
                      {new Date(version.createdAt).toLocaleString()} · {version.createdBy}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
      <div className="space-y-4">
        <div className="rounded-[2rem] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/40">Assistant</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">Edit your agent.</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-ink/50">
                Change how your assistant introduces itself, your hours, and what it knows, then test it
                in the WhatsApp simulator. Saving creates a new approved version for {practiceName}.
              </p>
            </div>
            <button
              type="button"
              onClick={openVersions}
              className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-semibold text-pine transition hover:border-pine"
            >
              <MIcon.refresh size={15} />
              Version history
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full bg-mist px-3 py-1 text-ink/55">{practiceName}</span>
            <span className="rounded-full bg-mist px-3 py-1 text-ink/55">{displayName}</span>
            {configVersion ? (
              <span className="rounded-full bg-mist px-3 py-1 text-ink/55">v{configVersion}</span>
            ) : null}
            <span
              className={`rounded-full px-3 py-1 ${
                dirty ? "bg-amber-100 text-amber-700" : "bg-lime text-pine-deep"
              }`}
            >
              {dirty ? "Unsaved draft" : "Approved"}
            </span>
          </div>
        </div>

        <div className="rounded-[2rem] bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/40">Identity</p>
          <label className="mt-3 block text-sm font-semibold">Assistant name</label>
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
        </div>

        <div className="rounded-[2rem] bg-white p-4 shadow-sm">
          <p className="px-1 text-xs font-semibold uppercase tracking-[0.18em] text-ink/40">Treatment</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {treatmentOptions.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setSelectedTreatment(id)}
                className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                  selectedTreatment === id
                    ? "border-pine bg-pine text-lime"
                    : "border-line bg-white text-ink/55 hover:border-pine hover:text-pine"
                }`}
              >
                {treatmentLabel(id)}
              </button>
            ))}
          </div>
        </div>

        <CollapsibleCard
          eyebrow="First WhatsApp message"
          title="First message"
          body={
            firstMessageOpen
              ? "Edit the opener patients see at the start of the conversation."
              : "The opener patients see first. Open to edit or lock it for testing."
          }
          open={firstMessageOpen}
          onToggle={() => setFirstMessageOpen((current) => !current)}
        >
          <textarea
            value={firstMessage}
            onChange={(event) => onFirstMessage(event.target.value)}
            disabled={firstMessageLocked}
            className={`min-h-28 w-full rounded-2xl border border-line bg-mist/50 p-4 text-sm leading-6 outline-none focus:ring-2 focus:ring-lime ${
              firstMessageLocked ? "cursor-not-allowed opacity-70" : ""
            }`}
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-ink/45">
              {firstMessage.length} characters · {firstMessageLocked ? "locked" : "editable"}
            </p>
            <button
              type="button"
              onClick={() => setFirstMessageLocked((current) => !current)}
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition ${
                firstMessageLocked
                  ? "border-pine bg-pine/5 text-pine"
                  : "border-line bg-white text-ink/60 hover:border-pine hover:text-pine"
              }`}
            >
              {firstMessageLocked ? "Unlock first message" : "Lock first message"}
            </button>
          </div>
        </CollapsibleCard>

        <div className="rounded-[2rem] bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/40">Per treatment</p>
          <h3 className="mt-2 text-lg font-semibold">First message · {treatmentLabel(selectedTreatment)}</h3>
          <p className="mt-1 text-xs text-ink/45">
            The opening message when a patient enquires about {treatmentLabel(selectedTreatment)}. Use the
            chips above to switch treatments. Leave blank to use the default first message.
          </p>
          <textarea
            value={treatmentFirstMessages[selectedTreatment] ?? ""}
            onChange={(event) => onTreatmentFirstMessage(selectedTreatment, event.target.value)}
            placeholder={`Hi 👋 Thanks for asking about ${treatmentLabel(selectedTreatment).toLowerCase()}…`}
            className="mt-3 min-h-24 w-full rounded-2xl border border-line bg-mist/50 p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-lime"
          />
        </div>

        <div className="rounded-[2rem] bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/40">Facts</p>
          <h3 className="mt-2 text-lg font-semibold">Practice knowledge</h3>
          <p className="mt-1 text-xs text-ink/45">
            Treatments, prices, address, parking, FAQs the assistant can mention.
          </p>
          <textarea
            value={knowledge}
            onChange={(event) => onKnowledge(event.target.value)}
            placeholder="e.g. Invisalign from £2,500. 2A Regent Road, LS29 9EA. Limited free parking outside."
            className="mt-3 min-h-32 w-full rounded-2xl border border-line bg-mist/50 p-4 text-sm leading-6 outline-none focus:ring-2 focus:ring-lime"
          />
        </div>

        <div className="rounded-[2rem] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/40">Knowledge</p>
              <h3 className="mt-2 text-lg font-semibold">
                {treatmentLabel(selectedTreatment)} fact cards
              </h3>
              <p className="mt-1 text-xs text-ink/45">
                The exact facts the assistant is allowed to use for {treatmentLabel(selectedTreatment)}.
                Scan your website to auto-fill, then refine.
              </p>
            </div>
            {facts.confidence > 0 ? (
              <span className="rounded-full bg-mist px-3 py-1 text-[11px] font-semibold text-ink/55">
                {Math.round(facts.confidence * 100)}% scraped confidence
              </span>
            ) : null}
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
            <input
              value={websiteUrl}
              onChange={(event) => {
                setWebsiteUrl(event.target.value);
                if (scan.status !== "idle") setScan({ status: "idle" });
              }}
              placeholder="https://your-practice.co.uk/invisalign"
              className="rounded-2xl border border-line bg-mist/50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-lime"
            />
            <button
              type="button"
              onClick={scanWebsite}
              disabled={scan.status === "scanning" || !websiteUrl.trim()}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-pine px-5 py-3 text-sm font-semibold text-lime transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <MIcon.refresh size={16} />
              {scan.status === "scanning" ? "Scanning..." : scan.status === "done" ? "Rescan" : "Scan website"}
            </button>
          </div>
          {scan.message && (
            <p className={`mt-2 text-xs ${scan.status === "error" ? "text-red-600" : "text-ink/55"}`}>
              {scan.message}
            </p>
          )}

          <div className="mt-5 space-y-4">
            <div>
              <label className="block text-sm font-semibold">General information</label>
              <textarea
                value={facts.generalInfo}
                onChange={(event) =>
                  onTreatmentFacts(selectedTreatment, { generalInfo: event.target.value })
                }
                placeholder={`What ${treatmentLabel(selectedTreatment)} is and who it helps.`}
                className="mt-2 min-h-24 w-full rounded-2xl border border-line bg-mist/50 p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-lime"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <LabeledLines
                label="Benefits"
                value={facts.benefits}
                placeholder="Straighter teeth in months"
                onChange={(value) => onTreatmentFacts(selectedTreatment, { benefits: value })}
              />
              <LabeledLines
                label="Suitability"
                value={facts.suitability}
                placeholder="Adults with mild–moderate crowding"
                onChange={(value) => onTreatmentFacts(selectedTreatment, { suitability: value })}
              />
            </div>

            <LabeledLines
              label="Process / steps"
              value={facts.process}
              placeholder="1. Free consultation"
              onChange={(value) => onTreatmentFacts(selectedTreatment, { process: value })}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-semibold">Pricing</label>
                <textarea
                  value={facts.pricing}
                  onChange={(event) =>
                    onTreatmentFacts(selectedTreatment, { pricing: event.target.value })
                  }
                  placeholder="From £2,500"
                  className="mt-2 min-h-20 w-full rounded-2xl border border-line bg-mist/50 p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-lime"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold">Finance offering</label>
                <textarea
                  value={facts.financeOffering}
                  onChange={(event) =>
                    onTreatmentFacts(selectedTreatment, { financeOffering: event.target.value })
                  }
                  placeholder="0% finance over 12 months"
                  className="mt-2 min-h-20 w-full rounded-2xl border border-line bg-mist/50 p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-lime"
                />
              </div>
            </div>

            <LabeledLines
              label="Pricing offers"
              hint="Current promotions, e.g. £500 off this month."
              value={facts.pricingOffers}
              placeholder="£500 off Invisalign in July"
              onChange={(value) => onTreatmentFacts(selectedTreatment, { pricingOffers: value })}
            />

            <LabeledLines
              label="Do not claim / contraindications"
              hint="Things the assistant must never promise or recommend."
              value={facts.contraindications}
              placeholder="Never guarantee a specific number of months"
              onChange={(value) => onTreatmentFacts(selectedTreatment, { contraindications: value })}
            />

            <div>
              <div className="flex items-center justify-between">
                <label className="block text-sm font-semibold">FAQs</label>
                <button
                  type="button"
                  onClick={() =>
                    onTreatmentFacts(selectedTreatment, {
                      faqs: [...facts.faqs, { question: "", answer: "" }],
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-pine transition hover:border-pine"
                >
                  <MIcon.plus size={13} /> Add FAQ
                </button>
              </div>
              <div className="mt-3 space-y-3">
                {facts.faqs.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-line px-4 py-3 text-xs text-ink/45">
                    No FAQs yet. Add the questions patients ask most.
                  </p>
                ) : (
                  facts.faqs.map((faq, index) => (
                    <div key={index} className="rounded-2xl border border-line bg-mist/40 p-3">
                      <div className="flex items-start gap-2">
                        <input
                          value={faq.question}
                          onChange={(event) => {
                            const next = facts.faqs.slice();
                            next[index] = { ...next[index], question: event.target.value };
                            onTreatmentFacts(selectedTreatment, { faqs: next });
                          }}
                          placeholder="Question"
                          className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm font-semibold outline-none focus:ring-2 focus:ring-lime"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            onTreatmentFacts(selectedTreatment, {
                              faqs: facts.faqs.filter((_, i) => i !== index),
                            })
                          }
                          className="mt-1 text-ink/35 transition hover:text-red-500"
                          aria-label="Remove FAQ"
                        >
                          <MIcon.close size={16} />
                        </button>
                      </div>
                      <textarea
                        value={faq.answer}
                        onChange={(event) => {
                          const next = facts.faqs.slice();
                          next[index] = { ...next[index], answer: event.target.value };
                          onTreatmentFacts(selectedTreatment, { faqs: next });
                        }}
                        placeholder="Answer"
                        className="mt-2 min-h-16 w-full rounded-xl border border-line bg-white p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-lime"
                      />
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-[2rem] bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/40">WhatsApp template</p>
          <h3 className="mt-2 text-lg font-semibold">
            Interactive opener · {treatmentLabel(selectedTreatment)}
          </h3>
          <p className="mt-1 text-xs text-ink/45">
            The structured WhatsApp message (header, body, buttons) sent for this treatment.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-semibold">Header</label>
              <input
                value={template.header}
                onChange={(event) => onTreatmentTemplate(selectedTreatment, { header: event.target.value })}
                placeholder="Straighten your smile ✨"
                className="mt-2 w-full rounded-2xl border border-line bg-mist/50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-lime"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold">Footer</label>
              <input
                value={template.footer}
                onChange={(event) => onTreatmentTemplate(selectedTreatment, { footer: event.target.value })}
                placeholder="Regent Dental"
                className="mt-2 w-full rounded-2xl border border-line bg-mist/50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-lime"
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="block text-sm font-semibold">Body</label>
            <textarea
              value={template.body}
              onChange={(event) => onTreatmentTemplate(selectedTreatment, { body: event.target.value })}
              placeholder="Hi {{name}} 👋 thanks for your interest in Invisalign…"
              className="mt-2 min-h-24 w-full rounded-2xl border border-line bg-mist/50 p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-lime"
            />
          </div>
          <div className="mt-3">
            <label className="block text-sm font-semibold">Sub-text</label>
            <input
              value={template.subtext}
              onChange={(event) => onTreatmentTemplate(selectedTreatment, { subtext: event.target.value })}
              placeholder="Reply to book your free consultation"
              className="mt-2 w-full rounded-2xl border border-line bg-mist/50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-lime"
            />
          </div>
          <div className="mt-3">
            <LabeledLines
              label="Buttons"
              hint="Up to 3 quick-reply buttons for WhatsApp."
              value={template.buttons}
              placeholder="Book a consultation"
              onChange={(value) =>
                onTreatmentTemplate(selectedTreatment, { buttons: value.slice(0, 3) })
              }
            />
          </div>
        </div>

        <div className="rounded-[2rem] bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/40">Practice details</p>
          <h3 className="mt-2 text-lg font-semibold">Miscellaneous info</h3>
          <p className="mt-1 text-xs text-ink/45">
            Shared facts the assistant can use across every treatment.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-semibold">Address</label>
              <input
                value={misc.address}
                onChange={(event) => onMisc({ address: event.target.value })}
                placeholder="2A Regent Road, LS29 9EA"
                className="mt-2 w-full rounded-2xl border border-line bg-mist/50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-lime"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold">Phone</label>
              <input
                value={misc.phone}
                onChange={(event) => onMisc({ phone: event.target.value })}
                placeholder="0113 000 0000"
                className="mt-2 w-full rounded-2xl border border-line bg-mist/50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-lime"
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="block text-sm font-semibold">Parking</label>
            <input
              value={misc.parking}
              onChange={(event) => onMisc({ parking: event.target.value })}
              placeholder="Limited free parking outside; pay-and-display nearby"
              className="mt-2 w-full rounded-2xl border border-line bg-mist/50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-lime"
            />
          </div>
          <div className="mt-3">
            <label className="block text-sm font-semibold">Notes</label>
            <textarea
              value={misc.notes}
              onChange={(event) => onMisc({ notes: event.target.value })}
              placeholder="Anything else the assistant should know."
              className="mt-2 min-h-20 w-full rounded-2xl border border-line bg-mist/50 p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-lime"
            />
          </div>
        </div>

        <div className="rounded-[2rem] bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/40">Other treatments</p>
          <h3 className="mt-2 text-lg font-semibold">Other menu items</h3>
          <p className="mt-1 text-xs text-ink/45">
            Non-core treatments the assistant can mention briefly and route to the team.
          </p>
          <textarea
            value={otherMenuItems}
            onChange={(event) => onOtherMenuItems(event.target.value)}
            placeholder="e.g. Root canal, crowns, dentures — book via reception."
            className="mt-3 min-h-24 w-full rounded-2xl border border-line bg-mist/50 p-4 text-sm leading-6 outline-none focus:ring-2 focus:ring-lime"
          />
        </div>

        <div className="rounded-[2rem] bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/40">Agent instructions</p>
          <h3 className="mt-2 text-lg font-semibold">Instruction patch</h3>
          <p className="mt-1 text-xs leading-6 text-ink/45">
            Add a small behaviour change and merge it into the master prompt. This affects tone and
            knowledge only, not tools.
          </p>
          <textarea
            value={instructionPatch}
            onChange={(event) => setInstructionPatch(event.target.value)}
            placeholder="Example: be more concise, ask one follow-up question, and escalate clinical suitability questions."
            className="mt-3 min-h-24 w-full rounded-2xl border border-line bg-mist/50 p-4 text-sm leading-6 outline-none focus:ring-2 focus:ring-lime"
          />
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={injectInstructions}
              disabled={!instructionPatch.trim()}
              className="inline-flex items-center gap-2 rounded-full bg-pine px-4 py-2 text-sm font-semibold text-lime transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <MIcon.spark size={16} />
              Inject instructions
            </button>
          </div>
        </div>

        <CollapsibleCard
          eyebrow="Advanced editor"
          title="Master prompt"
          body={promptOpen ? "Edit the full master prompt directly." : "Open only when editing the full system prompt."}
          open={promptOpen}
          onToggle={() => setPromptOpen((current) => !current)}
        >
          <textarea
            value={prompt}
            onChange={(event) => onPrompt(event.target.value)}
            className="min-h-[26rem] w-full rounded-2xl border border-line bg-white p-4 font-mono text-xs leading-6 outline-none focus:ring-2 focus:ring-lime"
          />
          <p className="mt-2 text-xs text-ink/45">{promptWordCount} words</p>
        </CollapsibleCard>

        <div className="rounded-[2rem] bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">{dirty ? "Draft changes ready" : "Current version approved"}</p>
              {saveState === "saved" && (
                <p className="mt-1 text-sm font-semibold text-pine">Saved. New version is live-ready.</p>
              )}
              {saveState === "error" && (
                <p className="mt-1 text-sm font-semibold text-red-600">Could not save. Try again.</p>
              )}
              {saveState !== "saved" && saveState !== "error" && (
                <p className="mt-1 text-sm text-ink/45">
                  Changes apply to new conversations once approved. Existing chats are unaffected.
                </p>
              )}
            </div>
            <button
              onClick={onRequestSave}
              disabled={saveState === "saving" || !dirty}
              className="inline-flex items-center gap-2 rounded-full bg-pine px-6 py-3 text-sm font-semibold text-lime transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <MIcon.check size={16} />
              {saveState === "saving" ? "Saving..." : dirty ? "Save & approve" : "Approved"}
            </button>
          </div>
        </div>
      </div>

      <div className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-[2rem] bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/40">Simulator</p>
              <h3 className="mt-1 text-lg font-semibold">WhatsApp playground</h3>
            </div>
            <button
              type="button"
              onClick={restartSim}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink/55 transition hover:border-pine hover:text-pine"
            >
              <MIcon.refresh size={14} />
              Restart
            </button>
          </div>
          <p className="mb-4 rounded-2xl bg-mist px-4 py-3 text-xs leading-5 text-ink/55">
            Test only. Messages here are not sent to WhatsApp — use this to check tone and safety.
          </p>
          <div className="flex h-[460px] flex-col overflow-hidden rounded-[1.5rem] border border-line bg-[#eee9e1]">
            <div className="flex items-center gap-3 bg-pine px-4 py-3 text-paper">
              <span className="grid size-9 place-items-center rounded-full bg-white/15 text-sm font-bold text-lime">
                {practiceName.charAt(0)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{practiceName}</p>
                <p className="text-xs text-paper/60">{displayName} · online</p>
              </div>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto px-3.5 py-4">
              {simMessages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === "assistant" ? "justify-start" : "justify-end"}`}
                >
                  <div
                    className={`max-w-[82%] whitespace-pre-wrap px-3 py-2 text-[15px] leading-[1.42] text-[#111b21] shadow-sm ${
                      message.role === "assistant"
                        ? "rounded-[10px] rounded-tl-[3px] bg-white"
                        : "rounded-[10px] rounded-tr-[3px] bg-[#d9fdd3]"
                    }`}
                  >
                    {message.content}
                  </div>
                </div>
              ))}
              {simBusy && (
                <div className="flex justify-start">
                  <div className="rounded-[10px] rounded-tl-[3px] bg-white px-3 py-2 text-[13px] text-[#667781] shadow-sm">
                    {displayName} is typing…
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-2 bg-[#eee9e1] px-3 py-2.5">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void sendSim();
                }}
                placeholder="Type a patient test message..."
                className="h-11 min-w-0 flex-1 rounded-full border-0 bg-white px-[18px] text-[15px] text-[#111b21] shadow-sm outline-none placeholder:text-[#667781]"
              />
              <button
                type="button"
                onClick={() => void sendSim()}
                disabled={simBusy || !draft.trim()}
                className="grid size-11 place-items-center rounded-full bg-pine text-lime transition hover:brightness-110 disabled:opacity-50"
                aria-label="Send test message"
              >
                <MIcon.send size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CollapsibleCard({
  eyebrow,
  title,
  body,
  open,
  onToggle,
  children,
}: {
  eyebrow: string;
  title: string;
  body: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-[2rem] bg-white p-5 shadow-sm">
      <button type="button" onClick={onToggle} className="flex w-full items-start justify-between gap-4 text-left" aria-expanded={open}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/40">{eyebrow}</p>
          <h3 className="mt-2 text-lg font-semibold">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-ink/45">{body}</p>
        </div>
        <span className="shrink-0 rounded-full bg-mist px-3 py-1 text-xs font-semibold text-ink/55">
          {open ? "Hide" : "Edit"}
        </span>
      </button>
      {open ? <div className="mt-4">{children}</div> : null}
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

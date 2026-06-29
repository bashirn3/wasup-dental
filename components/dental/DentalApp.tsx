"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AccountMenu from "@/components/auth/AccountMenu";
import { MIcon } from "@/components/mot/icons";
import { defaultAgentPrompt, defaultFirstMessage, treatmentLabels } from "@/lib/dental-demo-data";
import type { DentalDashboardData, DentalLead } from "@/lib/dental-types";

type TabKey = "leads" | "activity" | "agent" | "connect";

const tabs: [TabKey, string, typeof MIcon.users][] = [
  ["leads", "Leads", MIcon.users],
  ["activity", "Activity", MIcon.check],
  ["agent", "Agent", MIcon.spark],
  ["connect", "Connect", MIcon.gear],
];

const CLERK_ON = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
const ACTIVE_WORKSPACE_KEY = "wasup-dental-active-workspace";

export default function DentalApp() {
  const [tab, setTab] = useState<TabKey>("leads");
  const [data, setData] = useState<DentalDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [firstMessage, setFirstMessage] = useState(defaultFirstMessage);
  const [prompt, setPrompt] = useState(defaultAgentPrompt);
  const [activePracticeId, setActivePracticeId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(ACTIVE_WORKSPACE_KEY);
  });

  const load = useCallback(async () => {
    try {
      const query = activePracticeId ? `?practiceId=${encodeURIComponent(activePracticeId)}` : "";
      const res = await fetch(`/api/dashboard-data${query}`, { cache: "no-store" });
      const payload = await res.json();
      setData(payload);
      if (payload.practiceId && payload.practiceId !== activePracticeId) {
        setActivePracticeId(payload.practiceId);
        window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, payload.practiceId);
      }
    } finally {
      setLoading(false);
    }
  }, [activePracticeId]);

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
        setFirstMessage(payload.config.firstMessage ?? defaultFirstMessage);
        setPrompt(payload.config.prompt ?? defaultAgentPrompt);
      }
    }
    void loadConfig();
  }, []);

  const leads = useMemo(() => data?.leads ?? [], [data]);
  const workspaces = data?.workspaces ?? [];
  const selectedLead = useMemo(
    () => leads.find((lead) => lead.id === selectedLeadId) ?? leads[0] ?? null,
    [leads, selectedLeadId],
  );
  const stats = useMemo(() => buildStats(leads, data?.metrics), [leads, data?.metrics]);

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
          treatmentFocus: ["invisalign"],
          safetyRules: [
            "Do not diagnose.",
            "Do not guarantee results, prices, or finance approval.",
            "Escalate complaints, medical uncertainty, and sensitive cases.",
          ],
        }),
      });
      setSaveState(res.ok ? "saved" : "error");
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
                See every lead, conversation, AI action, and booking setting in one place.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {workspaces.length > 1 && (
                <select
                  value={data.practiceId ?? ""}
                  onChange={(event) => {
                    const next = event.target.value;
                    setActivePracticeId(next);
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
            <Stat label="AI actioned" value={stats.aiActioned} />
            <Stat label="Needs staff" value={stats.needsHuman} />
            <Stat label="Booked" value={stats.booked} />
            <Stat label="Source" value={data.sourceHealth.status === "fresh" ? "Fresh" : data.sourceHealth.status === "mock" ? "Demo" : "Check"} text />
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
          {tab === "leads" && (
            <LeadsPanel
              leads={leads}
              selectedLead={selectedLead}
              totalLeads={data.metrics?.leadTotal ?? leads.length}
              onSelect={setSelectedLeadId}
            />
          )}
          {tab === "activity" && <ActivityPanel data={data} />}
          {tab === "agent" && (
            <AgentPanel
              firstMessage={firstMessage}
              prompt={prompt}
              saveState={saveState}
              onFirstMessage={setFirstMessage}
              onPrompt={setPrompt}
              onSave={saveAgent}
            />
          )}
          {tab === "connect" && (
            <ConnectPanel data={data} provisioning={provisioning} onProvision={provisionDrafts} />
          )}
        </section>
      </div>

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

function LeadsPanel({
  leads,
  selectedLead,
  totalLeads,
  onSelect,
}: {
  leads: DentalLead[];
  selectedLead: DentalLead | null;
  totalLeads: number;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="overflow-hidden rounded-[2rem] bg-white shadow-sm">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold">Leads</h2>
          <p className="text-sm text-ink/50">
            Showing latest {leads.length.toLocaleString()} of {totalLeads.toLocaleString()} mirrored leads.
          </p>
        </div>
        <div className="divide-y divide-line">
          {leads.map((lead) => (
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
                </span>
                <span className="mt-1 flex flex-wrap gap-1.5">
                  <LanePill label={lead.boxName ?? lead.sourceSystem} />
                  <LanePill label={lead.boxStage ?? lead.status} muted />
                  <LanePill label={treatmentLabels[lead.treatment]} muted />
                </span>
                <span className="mt-2 block truncate text-sm text-ink/55">{lead.lastMessage}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <ChatPanel lead={selectedLead} />
    </div>
  );
}

function ChatPanel({ lead }: { lead: DentalLead | null }) {
  if (!lead) {
    return (
      <div className="rounded-[2rem] bg-white p-6 text-sm text-ink/55 shadow-sm">
        Select a lead to see the chat.
      </div>
    );
  }

  return (
    <aside className="rounded-[2rem] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between border-b border-line pb-4">
        <div>
          <h3 className="font-semibold">{lead.name}</h3>
          <p className="text-xs text-ink/45">{lead.phone}</p>
        </div>
        <LanePill label={lead.status} />
      </div>
      <div className="mt-4 space-y-3 rounded-[1.5rem] bg-[#eee9e1] p-4">
        {lead.messages.length ? (
          lead.messages.map((message) => (
            <div
              key={message.id}
              className={`max-w-[86%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                message.direction === "outbound"
                  ? "ml-auto rounded-br-sm bg-[#d9fdd3]"
                  : "rounded-bl-sm bg-white"
              }`}
            >
              <p>{message.body}</p>
              {message.aiGenerated && (
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-ink/35">
                  AI
                </p>
              )}
            </div>
          ))
        ) : (
          <p className="py-8 text-center text-sm text-ink/45">No transcript imported yet.</p>
        )}
      </div>
    </aside>
  );
}

function ActivityPanel({ data }: { data: DentalDashboardData }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="rounded-[2rem] bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Activity</h2>
        <div className="mt-4 divide-y divide-line">
          {data.activity.map((item) => (
            <div key={item.id} className="py-4">
              <p className="font-semibold">{item.title}</p>
              <p className="mt-1 text-sm text-ink/55">{item.description}</p>
              <p className="mt-2 text-xs text-ink/35">{item.createdAt}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-[2rem] bg-white p-5 shadow-sm">
        <h3 className="font-semibold">Source health</h3>
        <p className="mt-2 text-sm text-ink/55">{data.sourceHealth.detail}</p>
        <div className="mt-4 space-y-2">
          {data.integrations.map((integration) => (
            <div key={integration.id} className="flex items-center justify-between rounded-2xl bg-mist px-4 py-3 text-sm">
              <span className="font-semibold">{integration.displayName}</span>
              <span className="text-ink/50">{integration.healthLabel}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AgentPanel({
  firstMessage,
  prompt,
  saveState,
  onFirstMessage,
  onPrompt,
  onSave,
}: {
  firstMessage: string;
  prompt: string;
  saveState: string;
  onFirstMessage: (value: string) => void;
  onPrompt: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="rounded-[2rem] bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/40">Agent Builder</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">Behavior and knowledge only.</h2>
        <label className="mt-5 block text-sm font-semibold">First WhatsApp message</label>
        <textarea
          value={firstMessage}
          onChange={(event) => onFirstMessage(event.target.value)}
          className="mt-2 min-h-28 w-full rounded-2xl border border-line bg-mist/50 p-4 text-sm outline-none focus:ring-2 focus:ring-lime"
        />
        <label className="mt-5 block text-sm font-semibold">Master prompt</label>
        <textarea
          value={prompt}
          onChange={(event) => onPrompt(event.target.value)}
          className="mt-2 min-h-72 w-full rounded-2xl border border-line bg-mist/50 p-4 font-mono text-xs leading-6 outline-none focus:ring-2 focus:ring-lime"
        />
        <button
          onClick={onSave}
          className="mt-4 rounded-full bg-pine px-6 py-3 text-sm font-semibold text-lime transition hover:brightness-110"
        >
          {saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved as draft" : "Save draft"}
        </button>
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
            Thanks for asking. I can explain the consultation process and check a suitable appointment, but the dentist will confirm clinical suitability.
          </div>
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
        <h2 className="text-lg font-semibold">Connectors</h2>
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
        <h2 className="text-lg font-semibold">n8n Drafts</h2>
        <p className="mt-2 text-sm leading-6 text-ink/55">
          Provisioning creates inactive dry-run records only. It does not activate workflows, trigger webhooks, send WhatsApp messages, book in Dentally, or create Stripe payments.
        </p>
        <button
          onClick={onProvision}
          disabled={provisioning}
          className="mt-4 rounded-full bg-pine px-6 py-3 text-sm font-semibold text-lime transition hover:brightness-110 disabled:opacity-50"
        >
          {provisioning ? "Creating drafts..." : "Create inactive drafts"}
        </button>
        <div className="mt-4 space-y-2">
          {data.workflows.length ? (
            data.workflows.map((workflow) => (
              <div key={workflow.id} className="rounded-2xl bg-mist px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold">{workflow.displayName}</span>
                  <span className="text-ink/50">{workflow.active ? "Active" : "Inactive"}</span>
                </div>
                <p className="mt-1 text-xs text-ink/45">{workflow.templateKey}</p>
              </div>
            ))
          ) : (
            <p className="rounded-2xl bg-mist px-4 py-5 text-sm text-ink/50">
              No workflow drafts yet.
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

function buildStats(leads: DentalLead[], metrics?: DentalDashboardData["metrics"]) {
  return {
    total: metrics?.leadTotal ?? leads.length,
    aiActioned:
      metrics?.aiActionedTotal ??
      leads.filter((lead) => lead.messages.some((message) => message.aiGenerated)).length,
    needsHuman: metrics?.needsHumanTotal ?? leads.filter((lead) => lead.needsHuman).length,
    booked: metrics?.bookedTotal ?? leads.filter((lead) => lead.status === "booked").length,
  };
}

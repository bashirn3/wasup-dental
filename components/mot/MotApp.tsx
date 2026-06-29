"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AccountMenu from "@/components/auth/AccountMenu";
import { normalizePhone, normalizeRegistration } from "@/lib/csv";
import { MIcon } from "./icons";
import { CountUp } from "./ui";
import { AppCtx, type Filter, type MotCtx, type WaStatus } from "./context";
import { comparePendingLeadOrder, isLive, isPending, toLeadVM, type DbLead, type LeadVM } from "./data";
import { waLinkPhone } from "@/lib/wa-display";
import { syncStoredWasupInstance } from "@/lib/wa-sheet-logic";
import { LeadsScreen } from "./LeadsScreen";
import { AddSheet, ApproveScreen, EditLeadScreen } from "./ApproveScreen";
import { ScanScreen } from "./ScanScreen";
import { BookingsScreen, DaySheet } from "./BookingsScreen";
import { ThreadScreen, ThreadBar, CallSheet, type ThreadChat } from "./ThreadScreen";
import { SettingsScreen } from "./SettingsScreen";
import { WaSheet } from "./WaSheet";
import { CsvSheet } from "./CsvSheet";
import { AgentEditScreen } from "./AgentEditScreen";

const CLERK_ON = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

type TabKey = "leads" | "approve" | "bookings" | "settings";

const MT_TABS: [TabKey, string, (p: { size?: number; s?: number; className?: string }) => React.ReactNode][] = [
  ["leads", "Leads", MIcon.users],
  ["approve", "Approve", MIcon.check],
  ["bookings", "Bookings", MIcon.cal],
  ["settings", "Settings", MIcon.gear],
];
const TAB_TITLES: Record<TabKey, string> = {
  leads: "Leads",
  approve: "Approve",
  bookings: "Bookings",
  settings: "Settings",
};

type Tenant = {
  id: string;
  name: string | null;
  phone: string | null;
  wasup_phone: string | null;
  wasup_instance_id: string | null;
};

/* ── header (shared across tabs) ── */
function Header({
  tab,
  filter,
  leads,
  pendingCount,
  waStatus,
  garageName,
  onStat,
  onWa,
  threadChat,
  onCloseChat,
  onThreadCall,
  onThreadDelete,
}: {
  tab: TabKey;
  filter: Filter;
  leads: LeadVM[];
  pendingCount: number;
  waStatus: WaStatus;
  garageName: string;
  onStat: (f: Filter | "Approve") => void;
  onWa: () => void;
  threadChat?: ThreadChat | null;
  onCloseChat?: () => void;
  onThreadCall?: () => void;
  onThreadDelete?: () => void;
}) {
  const stats: [string, number, Filter | "Approve"][] = [
    ["Leads", leads.length, "All"],
    ["Approve", pendingCount, "Approve"],
    ["Due soon", leads.filter((l) => l.state === "soon").length, "Due soon"],
    ["Booked", leads.filter((l) => l.state === "booked").length, "Booked"],
  ];
  const onLeads = tab === "leads";
  const initial = (garageName || "G").trim().charAt(0).toUpperCase();
  const inThread = Boolean(threadChat);

  return (
    <div className={"mt-header" + (inThread ? " has-thread" : "")}>
      <div className="mt-brandrow">
        <span className="mt-wordmark" style={{ flex: 1 }}>
          RAPID<b>MOT</b>
        </span>
        <button className="mt-livepill" onClick={onWa}>
          <span className={"mt-livedot" + (waStatus === "disconnected" ? " off" : "")}></span>
          {waStatus === "checking" ? "Checking" : waStatus === "connected" ? "Connected" : "Reconnect"}
        </button>
        {CLERK_ON ? (
          <span className="mt-avatar">
            <AccountMenu variant="mobile" />
          </span>
        ) : (
          <button className="mt-avatar" aria-label="Account">
            {initial}
          </button>
        )}
      </div>

      {!inThread && (
        <h1 className="mt-headtitle" key={tab}>
          {TAB_TITLES[tab]}
        </h1>
      )}

      <div className={"mt-stats-wrap" + (tab === "bookings" ? " hide" : "")}>
        <div className="mt-stats">
          {stats.map(([label, n, f]) => {
            const on = f === "Approve" ? tab === "approve" : onLeads && filter === f;
            return (
              <button key={label} className={"mt-stat" + (on ? " on" : "")} onClick={() => onStat(f)}>
                <div className={"n" + (n === 0 ? " zero" : "")}>
                  <CountUp value={n} />
                </div>
                <div className="l">{label}</div>
              </button>
            );
          })}
        </div>
      </div>

      {inThread && threadChat && onCloseChat && (
        <ThreadBar
          chat={threadChat}
          embedded
          onBack={onCloseChat}
          onCall={onThreadCall ?? (() => undefined)}
          onDelete={onThreadDelete}
        />
      )}
    </div>
  );
}

/* ── tab bar with sliding indicator ── */
function TabBar({ tab, onTab, pendingCount }: { tab: TabKey; onTab: (k: TabKey) => void; pendingCount: number }) {
  const idx = MT_TABS.findIndex(([k]) => k === tab);
  const w = 100 / MT_TABS.length;
  return (
    <div className="mt-tabbar">
      <span className="mt-tab-ind" style={{ left: `calc(${idx * w}% + 22px)`, width: `calc(${w}% - 44px)` }}></span>
      {MT_TABS.map(([k, label, Ic]) => (
        <button key={k} data-tab={k} className={"mt-tab" + (tab === k ? " on" : "")} onClick={() => onTab(k)}>
          <Ic size={22} className="tic" s={tab === k ? 2 : 1.7} />
          <span>{label}</span>
          {k === "approve" && pendingCount > 0 && <span className="tbadge">{pendingCount}</span>}
        </button>
      ))}
    </div>
  );
}

/* ── root ── */
export default function MotApp({ tenantId }: { tenantId: string }) {
  const [tab, setTab] = useState<TabKey>("leads");
  const [prevTab, setPrevTab] = useState<TabKey | null>(null);
  const [dir, setDir] = useState(1);
  const [filter, setFilter] = useState<Filter>("All");

  const [dbLeads, setDbLeads] = useState<DbLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [waStatus, setWaStatus] = useState<WaStatus>("checking");

  const [thread, setThread] = useState<{ chat: ThreadChat; closing: boolean } | null>(null);
  const [threadCall, setThreadCall] = useState<{ closing: boolean } | null>(null);
  const [wa, setWa] = useState<{ closing: boolean } | null>(null);
  const [csv, setCsv] = useState<{ closing: boolean } | null>(null);
  const [day, setDay] = useState<{ date: string; closing: boolean } | null>(null);
  const [scan, setScan] = useState<{ closing: boolean } | null>(null);
  const [edit, setEdit] = useState<{ id: string; closing: boolean } | null>(null);
  const [agentEdit, setAgentEdit] = useState<{ closing: boolean } | null>(null);
  const [add, setAdd] = useState<{ closing: boolean } | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const T = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const later = (key: string, fn: () => void, ms: number) => {
    clearTimeout(T.current[key]);
    T.current[key] = setTimeout(fn, ms);
  };
  useEffect(() => {
    const timers = T.current;
    return () => Object.values(timers).forEach(clearTimeout);
  }, []);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    clearTimeout(T.current["toast"]);
    T.current["toast"] = setTimeout(() => setToastMsg(null), 2600);
  }, []);

  /* ── data: leads ── */
  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/leads?tenantId=${encodeURIComponent(tenantId)}`, { cache: "no-store" });
      const data = await res.json();
      setDbLeads((data.leads ?? []) as DbLead[]);
    } catch {
      /* keep current */
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    const t0 = window.setTimeout(() => void reload(), 0);
    const t = setInterval(() => void reload(), 30000);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
    };
  }, [reload]);

  /* ── data: tenant + WhatsApp status pill ── */
  const checkWa = useCallback(async () => {
    try {
      let res = await fetch(`/api/tenant?tenantId=${encodeURIComponent(tenantId)}`, { cache: "no-store" });
      let data = await res.json();
      let t = (data.tenant ?? null) as Tenant | null;

      if (!t?.wasup_instance_id) {
        const synced = await syncStoredWasupInstance(tenantId);
        if (synced) {
          res = await fetch(`/api/tenant?tenantId=${encodeURIComponent(tenantId)}`, { cache: "no-store" });
          data = await res.json();
          t = (data.tenant ?? null) as Tenant | null;
        }
      }

      setTenant(t);
      if (!t?.wasup_instance_id) {
        setWaStatus("disconnected");
        return;
      }
      const sres = await fetch(
        `/api/wasup/status?instanceId=${encodeURIComponent(t.wasup_instance_id)}&tenantId=${encodeURIComponent(
          tenantId,
        )}&mode=qr&phone=${encodeURIComponent(t.wasup_phone ?? "")}`,
        { cache: "no-store" },
      );
      if (!sres.ok) {
        setWaStatus("disconnected");
        return;
      }
      const s = await sres.json();
      setWaStatus(s.status === "connected" ? "connected" : "disconnected");
    } catch {
      setWaStatus("disconnected");
    }
  }, [tenantId]);

  useEffect(() => {
    const t0 = window.setTimeout(() => void checkWa(), 0);
    const t = setInterval(() => void checkWa(), 30000);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
    };
  }, [checkWa]);

  const leads = useMemo(() => dbLeads.filter(isLive).map(toLeadVM), [dbLeads]);
  const pending = useMemo(
    () => dbLeads.filter(isPending).map(toLeadVM).sort(comparePendingLeadOrder),
    [dbLeads],
  );

  /* ── tabs ── */
  const goTab = useCallback(
    (next: TabKey) => {
      if (next === tab || thread || edit || agentEdit) return;
      const order = MT_TABS.map(([k]) => k);
      setDir(order.indexOf(next) > order.indexOf(tab) ? 1 : -1);
      setPrevTab(tab);
      setTab(next);
      later("tab", () => setPrevTab(null), 360);
    },
    [agentEdit, edit, tab, thread],
  );

  const onStat = (f: Filter | "Approve") => {
    if (f === "Approve") {
      goTab("approve");
      return;
    }
    setFilter(f);
    if (tab !== "leads") goTab("leads");
  };

  /* ── thread ── */
  const openChat: MotCtx["openChat"] = (lead) => {
    setThread({
      chat: {
        leadId: lead.id ?? lead.leadId ?? null,
        name: lead.name,
        plate: lead.plate,
        phone: lead.phone,
      },
      closing: false,
    });
  };
  const closeChat = () => {
    setThreadCall(null);
    setThread((th) => th && { ...th, closing: true });
    later("thread", () => setThread(null), 340);
  };

  const closeThreadCall = () => {
    setThreadCall((c) => c && { ...c, closing: true });
    later("threadCall", () => setThreadCall(null), 330);
  };

  /* ── sheets ── */
  const openWa = () => setWa({ closing: false });
  const closeWa = () => {
    setWa((w) => w && { ...w, closing: true });
    later("wa", () => setWa(null), 330);
  };
  const openCsv = () => setCsv({ closing: false });
  const closeCsv = () => {
    setCsv((c) => c && { ...c, closing: true });
    later("csv", () => setCsv(null), 330);
  };
  const openDay = (date: string) => setDay({ date, closing: false });
  const closeDay = () => {
    setDay((d) => d && { ...d, closing: true });
    later("day", () => setDay(null), 330);
  };
  const openAdd = () => setAdd({ closing: false });
  const closeAdd = () => {
    setAdd((a) => a && { ...a, closing: true });
    later("add", () => setAdd(null), 330);
  };

  const openAgentEdit = () => setAgentEdit({ closing: false });
  const closeAgentEdit = () => {
    setAgentEdit((a) => a && { ...a, closing: true });
    later("agentEdit", () => setAgentEdit(null), 340);
  };

  /* ── scan ── */
  const openScan = () => setScan({ closing: false });
  const closeScan = () => {
    setScan((s) => s && { ...s, closing: true });
    later("scan", () => setScan(null), 340);
  };
  const finishScan: MotCtx["finishScan"] = (rows, review) => {
    const scanBatchId = `scan-${Date.now().toString(36)}`;
    const payload = rows
      .filter((r) => r.plate || r.phone || r.name)
      .map((r, scanOrder) => {
        const parts = (r.name ?? "").trim().split(/\s+/);
        return {
          firstName: parts[0] || undefined,
          lastName: parts.slice(1).join(" ") || undefined,
          phone: normalizePhone(r.phone) ?? "",
          registration: normalizeRegistration(r.plate) || undefined,
          source: "upload" as const,
          status: "queued" as const,
          scanBatchId,
          scanOrder,
        };
      });
    closeScan();
    if (payload.length === 0) return;
    void (async () => {
      try {
        const res = await fetch("/api/leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tenantId, leads: payload }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "import_failed");
        await reload();
        const inserted = Number(data.inserted ?? payload.length);
        const skipped = Number(data.skippedDuplicates ?? 0);
        const msg =
          skipped > 0
            ? `${inserted} rows in Approve, ${skipped} duplicate${skipped === 1 ? "" : "s"} dropped`
            : `${inserted} rows sent to Approve`;
        if (review) {
          toast(msg);
          setTimeout(() => goTab("approve"), 120);
        } else {
          toast(msg);
        }
      } catch {
        toast("Saving the scanned rows failed — try again");
      }
    })();
  };

  /* ── approve queue ── */
  const patchLeads = useCallback(
    async (ids: string[], action: "approve" | "reject" | "update" | "delete", fields?: Record<string, unknown>) => {
      const res = await fetch("/api/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, ids, action, fields }),
      });
      if (!res.ok) throw new Error("update_failed");
    },
    [tenantId],
  );

  const approve = async (ids: string[]) => {
    /* optimistic */
    setDbLeads((d) => d.map((l) => (ids.includes(l.id) ? { ...l, status: "new" } : l)));
    try {
      await patchLeads(ids, "approve");
      toast(ids.length > 1 ? `${ids.length} leads approved` : "Lead approved");
    } catch {
      toast("Approve failed — try again");
    }
    void reload();
  };

  const reject = async (ids: string[]) => {
    setDbLeads((d) => d.filter((l) => !ids.includes(l.id)));
    try {
      await patchLeads(ids, "reject");
      toast(ids.length > 1 ? `${ids.length} removed` : "Removed");
    } catch {
      toast("Remove failed — try again");
    }
    void reload();
  };

  const deleteLeads = async (ids: string[]) => {
    if (thread?.chat.leadId && ids.includes(thread.chat.leadId)) closeChat();
    setDbLeads((d) => d.filter((l) => !ids.includes(l.id)));
    try {
      await patchLeads(ids, "delete");
      toast(ids.length > 1 ? `${ids.length} leads deleted` : "Lead deleted");
    } catch {
      toast("Delete failed — try again");
    }
    void reload();
  };

  const updatePending: MotCtx["updatePending"] = async (id, f) => {
    const parts = (f.name ?? "").trim().split(/\s+/);
    try {
      await patchLeads([id], "update", {
        firstName: parts[0] || null,
        lastName: parts.slice(1).join(" ") || null,
        phone: normalizePhone(f.phone) ?? f.phone ?? "",
        registration: normalizeRegistration(f.plate),
        ...(f.motDueDate !== undefined ? { motDueDate: f.motDueDate } : {}),
        ...(f.vehicle !== undefined ? { vehicle: f.vehicle } : {}),
      });
      await reload();
    } catch {
      toast("Couldn't save — try again");
    }
  };

  const addPending: MotCtx["addPending"] = async (f) => {
    const parts = (f.name ?? "").trim().split(/\s+/);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          leads: [
            {
              firstName: parts[0] || undefined,
              lastName: parts.slice(1).join(" ") || undefined,
              phone: normalizePhone(f.phone) ?? "",
              registration: normalizeRegistration(f.plate) || undefined,
              source: "manual",
              status: "queued",
            },
          ],
        }),
      });
      if (!res.ok) throw new Error("add_failed");
      await reload();
    } catch {
      toast("Couldn't add that lead — try again");
    }
  };

  /* ── edit layer ── */
  const openEdit = (id: string) => setEdit({ id, closing: false });
  const closeEdit = (saved?: boolean) => {
    setEdit((e) => e && { ...e, closing: true });
    later("edit", () => setEdit(null), 340);
    if (saved) setTimeout(() => toast("Saved"), 240);
  };

  const ctx: MotCtx = {
    tenantId,
    garageName: tenant?.name ?? "Your garage",
    garagePhone: waLinkPhone(tenant),
    waStatus,
    filter,
    setFilter,
    toast,
    leads,
    pending,
    loading,
    reload,
    openChat,
    closeChat,
    openCsv,
    openDay,
    closeDay,
    openScan,
    closeScan,
    finishScan,
    approve,
    reject,
    deleteLeads,
    updatePending,
    addPending,
    openEdit,
    closeEdit,
    openAdd,
    openAgentEdit,
    closeAgentEdit,
  };

  const Screen: Record<TabKey, () => React.ReactNode> = {
    leads: LeadsScreen,
    approve: ApproveScreen,
    bookings: BookingsScreen,
    settings: SettingsScreen,
  };
  const Cur = Screen[tab];
  const Prev = prevTab ? Screen[prevTab] : null;

  return (
    <AppCtx.Provider value={ctx}>
      <div className="mt-viewport">
        <div className="mt-device">
          <TabBar tab={tab} onTab={goTab} pendingCount={pending.length} />
          <div className={"mt-main" + (thread ? " has-thread" : "")}>
            <Header
              tab={tab}
              filter={filter}
              leads={leads}
              pendingCount={pending.length}
              waStatus={waStatus}
              garageName={tenant?.name ?? ""}
              onStat={onStat}
              onWa={openWa}
              threadChat={thread?.chat ?? null}
              onCloseChat={thread ? closeChat : undefined}
              onThreadCall={thread ? () => setThreadCall({ closing: false }) : undefined}
              onThreadDelete={
                thread?.chat.leadId
                  ? () => void deleteLeads([thread.chat.leadId!])
                  : undefined
              }
            />
            <div className="mt-stage">
              {Prev && (
                <div className={"mt-screen " + (dir === 1 ? "go-l-out" : "go-r-out")} style={{ zIndex: 1 }}>
                  <Prev />
                </div>
              )}
              <div className={"mt-screen " + (prevTab ? (dir === 1 ? "go-l-in" : "go-r-in") : "")} style={{ zIndex: 2 }} key={tab}>
                <Cur />
              </div>
              {toastMsg && (
                <div className="toast">
                  <span className="tk">
                    <MIcon.check size={16} s={2.4} />
                  </span>
                  {toastMsg}
                </div>
              )}
              {thread && (
                <div className={"mt-thread-layer" + (thread.closing ? " pop-out" : " push-in")}>
                  <ThreadScreen chat={thread.chat} embedded />
                </div>
              )}
              {edit && (
                <div className={"mt-thread-layer " + (edit.closing ? "pop-out" : "push-in")}>
                  <EditLeadScreen id={edit.id} />
                </div>
              )}
            </div>
          </div>

          {threadCall && thread && (
            <CallSheet c={thread.chat} closing={threadCall.closing} onClose={closeThreadCall} />
          )}

          {agentEdit && (
            <div className={"mt-agent-layer" + (agentEdit.closing ? " closing" : "")}>
              <AgentEditScreen />
            </div>
          )}

          {scan && (
            <div className={"mt-scan-layer" + (scan.closing ? " closing" : "")}>
              <ScanScreen />
            </div>
          )}

          {wa && (
            <WaSheet
              tenantId={tenantId}
              garageName={tenant?.name ?? undefined}
              instanceId={tenant?.wasup_instance_id ?? null}
              phone={tenant?.wasup_phone ?? ""}
              closing={wa.closing}
              onClose={closeWa}
              toast={toast}
              onStatus={(connected) => setWaStatus(connected ? "connected" : "disconnected")}
              onRefresh={() => void checkWa()}
            />
          )}
          {csv && (
            <CsvSheet
              tenantId={tenantId}
              closing={csv.closing}
              onClose={closeCsv}
              toast={toast}
              onImported={(count) => {
                closeCsv();
                void reload();
                toast(`${count} rows sent to Approve`);
                setTimeout(() => goTab("approve"), 200);
              }}
            />
          )}
          {day && <DaySheet date={day.date} closing={day.closing} onClose={closeDay} />}
          {add && <AddSheet closing={add.closing} onClose={closeAdd} />}
        </div>
      </div>
    </AppCtx.Provider>
  );
}

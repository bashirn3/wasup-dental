"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AccountMenu from "@/components/auth/AccountMenu";
import { normalizePhone, normalizeRegistration } from "@/lib/csv";
import { MIcon } from "@/components/mot/icons";
import type { Filter, WaStatus } from "@/components/mot/context";
import { comparePendingLeadOrder, isLive, isPending, toLeadVM, type DbLead, type LeadVM } from "@/components/mot/data";
import { DeskContext, type DeskCtx, type DeskModal, type DeskTab } from "./context";
import { DeskLeadsScreen, DeskApproveScreen, DeskBookingsScreen, DeskSettingsScreen } from "./DeskScreens";
import {
  DeskThreadDrawer,
  DeskEditorDrawer,
  DeskCsvModal,
  DeskAddModal,
  DeskScanModal,
  DeskWaModal,
} from "./DeskPanels";
import type { ThreadChat } from "@/components/mot/ThreadScreen";
import { waLinkPhone } from "@/lib/wa-display";
import { syncStoredWasupInstance } from "@/lib/wa-sheet-logic";

const CLERK_ON = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

type Tenant = {
  id: string;
  name: string | null;
  phone: string | null;
  wasup_phone: string | null;
  wasup_instance_id: string | null;
};

const DK_TABS: [DeskTab, string, typeof MIcon.users][] = [
  ["leads", "Leads", MIcon.users],
  ["approve", "Approve", MIcon.check],
  ["bookings", "Bookings", MIcon.cal],
  ["settings", "Settings", MIcon.gear],
];
const DK_TITLES: Record<DeskTab, string> = {
  leads: "Leads",
  approve: "Approve",
  bookings: "Bookings",
  settings: "Settings",
};

function fmtSidebarPhone(value: string): string {
  const digits = (value || "").replace(/\D/g, "");
  if (!digits) return "No number linked";
  return digits.startsWith("44")
    ? `+44 ${digits.slice(2, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`
    : `+${digits}`;
}

export default function DeskApp({ tenantId }: { tenantId: string }) {
  const [tab, setTab] = useState<DeskTab>("leads");
  const [filter, setFilter] = useState<Filter>("All");
  const [dbLeads, setDbLeads] = useState<DbLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [waStatus, setWaStatus] = useState<WaStatus>("checking");

  const [thread, setThread] = useState<{ chat: ThreadChat; closing: boolean } | null>(null);
  const [edit, setEdit] = useState<{ id: string; closing: boolean } | null>(null);
  const [modal, setModal] = useState<{ kind: NonNullable<DeskModal>; closing: boolean } | null>(null);
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

  const goTab = useCallback((next: DeskTab) => setTab(next), []);

  const openChat: DeskCtx["openChat"] = (lead) => {
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
    setThread((th) => th && { ...th, closing: true });
    later("thread", () => setThread(null), 310);
  };

  const openEdit = (id: string) => setEdit({ id, closing: false });
  const closeEdit = () => {
    setEdit((e) => e && { ...e, closing: true });
    later("edit", () => setEdit(null), 310);
  };

  const openModal = (kind: NonNullable<DeskModal>) => setModal({ kind, closing: false });
  const closeModal = () => {
    setModal((m) => m && { ...m, closing: true });
    later("modal", () => setModal(null), 270);
  };

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

  const updatePending: DeskCtx["updatePending"] = async (id, f) => {
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

  const addPending: DeskCtx["addPending"] = async (f) => {
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

  const finishScan: DeskCtx["finishScan"] = (rows, review) => {
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
    closeModal();
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
            : `${inserted} rows in Approve`;
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

  const garagePhone = waLinkPhone(tenant);
  const waPhone = tenant?.wasup_phone ?? "";
  const garageName = tenant?.name ?? "Your garage";
  const initial = garageName.trim().charAt(0).toUpperCase() || "G";

  const ctx: DeskCtx = {
    tenantId,
    garageName,
    garagePhone,
    waStatus,
    tab,
    goTab,
    filter,
    setFilter,
    toast,
    leads,
    pending,
    loading,
    reload,
    openChat,
    closeChat,
    openEdit,
    closeEdit,
    openModal,
    closeModal,
    approve,
    reject,
    deleteLeads,
    updatePending,
    addPending,
    finishScan,
    instanceId: tenant?.wasup_instance_id ?? null,
  };

  const Screen = {
    leads: DeskLeadsScreen,
    approve: DeskApproveScreen,
    bookings: DeskBookingsScreen,
    settings: DeskSettingsScreen,
  }[tab];

  return (
    <DeskContext.Provider value={ctx}>
      <div className="dk-app">
        <aside className="dk-side">
          <div className="dk-wordmark">
            RAPID<b>MOT</b>
          </div>
          <nav className="dk-nav">
            {DK_TABS.map(([k, label, Ic]) => (
              <button key={k} className={"dk-navitem" + (tab === k ? " on" : "")} onClick={() => goTab(k)}>
                <Ic size={19} s={tab === k ? 2 : 1.7} />
                {label}
                {k === "approve" && pending.length > 0 && <span className="nbadge">{pending.length}</span>}
              </button>
            ))}
          </nav>
          <div className="dk-side-foot">
            <button className="dk-wa" onClick={() => openModal("wa")}>
              <span className={"dot" + (waStatus === "connected" ? "" : " off")} />
              <span style={{ minWidth: 0, textAlign: "left" }}>
                <span className="t">
                  {waStatus === "checking"
                    ? "Checking WhatsApp…"
                    : waStatus === "connected"
                      ? "WhatsApp connected"
                      : "WhatsApp — reconnect"}
                </span>
                <span className="s">{fmtSidebarPhone(garagePhone)}</span>
              </span>
            </button>
            {CLERK_ON ? (
              <AccountMenu variant="desktop" label="Account" subLabel={garageName} />
            ) : (
              <div className="dk-user">
                <span className="dk-ava">{initial}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="n">{initial}</span>
                  <span className="g">{garageName}</span>
                </span>
              </div>
            )}
          </div>
        </aside>

        <div className="dk-main">
          <div className="dk-topbar">
            <h1 className="dk-title" key={tab}>
              {DK_TITLES[tab]}
            </h1>
            <span className="spacer" />
            {tab === "leads" && (
              <>
                <button className="btn btn-ghost" onClick={() => openModal("csv")}>
                  <MIcon.upload size={16} /> Import CSV
                </button>
                <button className="btn btn-primary" onClick={() => openModal("scan")}>
                  <MIcon.upload size={16} /> Upload scans
                </button>
              </>
            )}
            {tab === "approve" && (
              <button className="btn btn-primary" onClick={() => openModal("add")}>
                <MIcon.plus size={16} /> Add leads
              </button>
            )}
          </div>
          <div className="dk-body">
            <Screen key={tab} />
          </div>
        </div>

        {thread && <DeskThreadDrawer chat={thread.chat} closing={thread.closing} />}
        {edit && <DeskEditorDrawer id={edit.id} closing={edit.closing} />}
        {modal?.kind === "csv" && (
          <DeskCsvModal
            tenantId={tenantId}
            closing={modal.closing}
            onClose={closeModal}
            toast={toast}
            onImported={(count) => {
              closeModal();
              void reload();
              toast(`${count} rows sent to Approve`);
              setTimeout(() => goTab("approve"), 200);
            }}
          />
        )}
        {modal?.kind === "add" && <DeskAddModal closing={modal.closing} onClose={closeModal} />}
        {modal?.kind === "scan" && <DeskScanModal closing={modal.closing} onClose={closeModal} />}
        {modal?.kind === "wa" && (
          <DeskWaModal
            tenantId={tenantId}
            garageName={tenant?.name ?? undefined}
            instanceId={tenant?.wasup_instance_id ?? null}
            phone={tenant?.wasup_instance_id ? waPhone : ""}
            closing={modal.closing}
            onClose={closeModal}
            toast={toast}
            onStatus={(connected) => setWaStatus(connected ? "connected" : "disconnected")}
            onRefresh={() => void checkWa()}
          />
        )}
        {toastMsg && (
          <div className="dk-toast">
            <span className="tk">
              <MIcon.check size={16} s={2.4} />
            </span>
            {toastMsg}
          </div>
        )}
      </div>
    </DeskContext.Provider>
  );
}

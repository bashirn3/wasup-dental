"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MIcon } from "@/components/mot/icons";
import { CountUp, Empty, Segmented, Stepper, Toggle } from "@/components/mot/ui";
import { toBookingVM, WINDOW_OPTIONS, type BookingVM } from "@/components/mot/data";
import {
  duplicateGroups,
  duplicateReviewMap,
  duplicateTabCounts,
  filterByDuplicateTab,
  type DuplicateTab,
} from "@/components/mot/duplicate-review";
import type { Filter } from "@/components/mot/context";
import { useDesk } from "./context";
import { DeleteAccountSection } from "@/components/settings/DeleteAccountSection";
import { outreachResultMessage } from "@/components/mot/SettingsScreen";

const DK_FILTERS: Filter[] = ["All", "Overdue", "Due soon", "Booked"];
const DK_FSTATE: Record<Exclude<Filter, "All">, string> = {
  Overdue: "overdue",
  "Due soon": "soon",
  Booked: "booked",
};

function badgeCls(state: string) {
  return state === "overdue"
    ? "badge-overdue"
    : state === "booked"
      ? "badge-booked"
      : state === "soon"
        ? "badge-soon"
        : "badge-ok";
}

export function DeskLeadsScreen() {
  const { leads, pending, filter, setFilter, openChat, goTab, deleteLeads } = useDesk();
  const [sel, setSel] = useState<string[]>([]);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const shown = filter === "All" ? leads : leads.filter((l) => l.state === DK_FSTATE[filter as Exclude<Filter, "All">]);
  const allSel = sel.length === shown.length && shown.length > 0;
  const stats: [string, number, () => void][] = [
    ["Leads", leads.length, () => setFilter("All")],
    ["Approve", pending.length, () => goTab("approve")],
    ["Due soon", leads.filter((l) => l.state === "soon").length, () => setFilter("Due soon")],
    ["Booked", leads.filter((l) => l.state === "booked").length, () => setFilter("Booked")],
  ];

  return (
    <div className="dk-screen">
      <div className="dk-stats stagger">
        {stats.map(([label, n, fn]) => (
          <button key={label} className="dk-stat" onClick={fn}>
            <div className={"n" + (n === 0 ? " zero" : "")}>
              <CountUp value={n} />
            </div>
            <div className="l">{label}</div>
          </button>
        ))}
      </div>

      {leads.length === 0 ? (
        <div className="card">
          <Empty icon={<MIcon.clip size={30} s={1.5} />} title="No leads yet">
            Import a CSV or upload day-book scans — leads wait in Approve until you check them.
          </Empty>
        </div>
      ) : (
        <>
          <div className="chips">
            {DK_FILTERS.map((f) => {
              const n = f === "All" ? leads.length : leads.filter((l) => l.state === DK_FSTATE[f]).length;
              return (
                <button key={f} className={"chip" + (filter === f ? " on" : "")} onClick={() => setFilter(f)}>
                  {f} <span className="ct">{n}</span>
                </button>
              );
            })}
          </div>
          {sel.length > 0 && (
            <div className="ap-bulkbar">
              <button
                className={"sel" + (allSel ? " on" : "")}
                onClick={() => setSel(allSel ? [] : shown.map((l) => l.id))}
                aria-label="Select all"
              >
                <MIcon.check size={13} s={3} />
              </button>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{sel.length} selected</span>
              <span style={{ flex: 1 }} />
              <button className="btn btn-ghost" style={{ color: "var(--danger)" }} onClick={() => { void deleteLeads(sel); setSel([]); }}>
                Delete
              </button>
              <button className="btn btn-ghost" onClick={() => setSel([])}>
                Cancel
              </button>
            </div>
          )}
          <div className="card" style={{ overflow: "hidden" }} key={filter}>
            <div className="stagger">
              {shown.map((l, i) => (
                <Fragment key={l.id}>
                  {i > 0 && <hr className="hair" style={{ marginLeft: 54 }} />}
                  <div className="dk-row" style={{ paddingLeft: 16 }}>
                    <button className={"sel" + (sel.includes(l.id) ? " on" : "")} onClick={() => toggle(l.id)} aria-label="Select">
                      <MIcon.check size={13} s={3} />
                    </button>
                    <span className="plate">{l.plate || "—"}</span>
                    <div style={{ flex: "0 0 200px", minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="lead-name">{l.name}</span>
                      {l.contacted && <MIcon.ticks size={15} s={2} className="ticks" />}
                    </div>
                    <span className="dk-col-car">{l.car || "—"}</span>
                    <span className="dk-col-due">{l.due}</span>
                    <span className={"badge " + badgeCls(l.state)}>{l.badge}</span>
                    <span style={{ flex: 1 }} />
                    <button className="iconbtn" onClick={() => openChat(l)} aria-label={"Conversation with " + l.name}>
                      <MIcon.chat size={18} />
                    </button>
                    <button
                      className="ap-act no"
                      onClick={() => {
                        void deleteLeads([l.id]);
                        setSel((s) => s.filter((x) => x !== l.id));
                      }}
                      aria-label={"Delete " + l.name}
                    >
                      <MIcon.trash size={14} s={2} />
                    </button>
                  </div>
                </Fragment>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function DeskApproveScreen() {
  const { pending, approve, reject, openEdit } = useDesk();
  const [sel, setSel] = useState<string[]>([]);
  const [tab, setTab] = useState<DuplicateTab>("all");
  const duplicates = useMemo(() => duplicateReviewMap(pending), [pending]);
  const counts = useMemo(() => duplicateTabCounts(pending), [pending]);
  const visible = useMemo(() => filterByDuplicateTab(pending, tab), [pending, tab]);
  const groups = useMemo(() => duplicateGroups(pending, tab), [pending, tab]);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const allSel = visible.length > 0 && visible.every((p) => sel.includes(p.id));
  const keepOnly = (groupIds: string[], keepId: string) => {
    const rejectIds = groupIds.filter((id) => id !== keepId);
    if (rejectIds.length) void reject(rejectIds);
    setSel((s) => s.filter((id) => !rejectIds.includes(id)));
  };

  return (
    <div className="dk-screen">
      {pending.length === 0 ? (
        <div className="card">
          <Empty icon={<MIcon.check size={30} s={1.5} />} title="All clear">
            Scanned and imported leads wait here for a quick check before they go live.
          </Empty>
        </div>
      ) : (
        <>
          {sel.length > 0 && (
            <div className="ap-bulkbar">
              <button
                className={"sel" + (allSel ? " on" : "")}
                onClick={() => setSel(allSel ? [] : visible.map((p) => p.id))}
                aria-label="Select all"
              >
                <MIcon.check size={13} s={3} />
              </button>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{sel.length} selected</span>
              <span style={{ flex: 1 }} />
              <button className="btn btn-ghost" onClick={() => { void reject(sel); setSel([]); }}>
                Reject
              </button>
              <button className="btn btn-primary" onClick={() => { void approve(sel); setSel([]); }}>
                Approve {sel.length}
              </button>
            </div>
          )}
          <div className="dup-tabs dk-dup-tabs" role="tablist" aria-label="Approve filters">
            {[
              ["all", "All", counts.all],
              ["duplicates", "Duplicates", counts.duplicates],
              ["same-number", "Same number", counts.sameNumber],
              ["same-plate", "Same plate", counts.samePlate],
            ].map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                className={"dup-tab" + (tab === key ? " on" : "")}
                onClick={() => setTab(key as DuplicateTab)}
              >
                {label} <span>{count}</span>
              </button>
            ))}
          </div>
          {groups.length > 0 && (
            <div className="dup-groups dk-dup-groups">
              {groups.map((group) => (
                <div className="dup-group" key={`${group.type}:${group.key}`}>
                  <div>
                    <b>{group.label}</b>
                    <span>{group.leads.length} queued copies</span>
                  </div>
                  <button
                    type="button"
                    className="dup-keep"
                    onClick={() => keepOnly(group.leads.map((lead) => lead.id), group.suggestedKeepId)}
                  >
                    Keep best
                  </button>
                  <div className="dup-choices">
                    {group.leads.map((lead) => (
                      <button
                        key={lead.id}
                        type="button"
                        onClick={() => keepOnly(group.leads.map((item) => item.id), lead.id)}
                      >
                        Keep {lead.plate || lead.name || lead.phone || "row"}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="card" style={{ overflow: "hidden" }}>
            <div className="stagger">
              {visible.map((p, i) => {
                const dupe = duplicates.get(p.id);
                return (
                  <Fragment key={p.id}>
                    {i > 0 && <hr className="hair" style={{ marginLeft: 54 }} />}
                    <div className="dk-row" style={{ paddingLeft: 16 }}>
                      <button className={"sel" + (sel.includes(p.id) ? " on" : "")} onClick={() => toggle(p.id)} aria-label="Select">
                        <MIcon.check size={13} s={3} />
                      </button>
                      <button className="row" style={{ flex: 1, minWidth: 0, gap: 14 }} onClick={() => openEdit(p.id)}>
                        <span className="plate">{p.plate || "- -"}</span>
                        <span style={{ flex: "0 0 240px", minWidth: 0 }}>
                          <span className="lead-name">
                            {p.hasName ? p.name : <span className="ap-missing">No name</span>}
                            {dupe && (
                              <span className="dup-badge" title={dupe.detail}>
                                {dupe.label}
                              </span>
                            )}
                          </span>
                        </span>
                        <span className="lead-meta" style={{ flex: 1 }}>
                          {p.phone || <span className="ap-missing">No number</span>}
                          {p.due && <span> · {p.due}</span>}
                        </span>
                      </button>
                      <button
                        className="ap-act yes"
                        onClick={() => { void approve([p.id]); setSel((s) => s.filter((x) => x !== p.id)); }}
                        aria-label="Approve"
                      >
                        <MIcon.check size={15} s={2.4} />
                      </button>
                      <button
                        className="ap-act no"
                        onClick={() => { void reject([p.id]); setSel((s) => s.filter((x) => x !== p.id)); }}
                        aria-label="Reject"
                      >
                        {!p.hasName && !p.phone ? <MIcon.trash size={14} s={2} /> : <MIcon.close size={14} s={2.4} />}
                      </button>
                    </div>
                  </Fragment>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOWS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const dateKey = (y: number, m: number, d: number) =>
  y + "-" + String(m + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");

export function DeskBookingsScreen() {
  const { tenantId, openChat } = useDesk();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [bookings, setBookings] = useState<BookingVM[]>([]);
  const [selDate, setSelDate] = useState<string | null>(null);

  const load = useCallback(async () => {
    const from = new Date(Date.UTC(ym.y, ym.m, 1)).toISOString();
    const to = new Date(Date.UTC(ym.y, ym.m + 1, 1)).toISOString();
    const res = await fetch(
      `/api/bookings?tenantId=${encodeURIComponent(tenantId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { cache: "no-store" },
    );
    const data = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vms = ((data.bookings ?? []) as any[]).map(toBookingVM);
    setBookings(vms);
  }, [tenantId, ym.m, ym.y]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    if (bookings.length === 0) return;
    setSelDate((cur) => {
      if (cur && bookings.some((b) => b.date === cur)) return cur;
      return bookings[0]?.date ?? null;
    });
  }, [bookings]);

  const move = (delta: number) =>
    setYm(({ y, m }) => {
      const t = m + delta;
      return { y: y + Math.floor(t / 12), m: ((t % 12) + 12) % 12 };
    });

  const first = new Date(ym.y, ym.m, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(ym.y, ym.m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);

  const byDate: Record<string, BookingVM[]> = {};
  bookings.forEach((b) => {
    (byDate[b.date] = byDate[b.date] || []).push(b);
  });

  const today = { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
  const next7 = bookings.filter((b) => {
    const d = new Date(b.date + "T00:00:00");
    const t = new Date(today.y, today.m, today.d);
    return d >= t && (d.getTime() - t.getTime()) / 864e5 < 7;
  }).length;

  const dayItems = selDate ? byDate[selDate] || [] : [];
  const selLabel = selDate
    ? (() => {
        const [y, m, d] = selDate.split("-").map(Number);
        return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
      })()
    : null;

  return (
    <div className="dk-screen">
      <div className="bk-totals stagger">
        {(
          [
            ["Next 7 days", next7],
            ["This month", bookings.length],
            ["Total", bookings.length],
          ] as [string, number][]
        ).map(([l, n]) => (
          <div className="dk-stat" key={l} style={{ cursor: "default" }}>
            <div className={"n" + (n === 0 ? " zero" : "")}>
              <CountUp value={n} />
            </div>
            <div className="l">{l}</div>
          </div>
        ))}
      </div>

      <div className="bk-grid">
        <div className="card">
          <div className="cal-head">
            <button className="iconbtn" onClick={() => move(-1)} aria-label="Previous month">
              <MIcon.back size={17} />
            </button>
            <span className="cal-title" key={ym.y + "-" + ym.m}>
              {MONTHS[ym.m]} {ym.y}
            </span>
            <button className="iconbtn" onClick={() => move(1)} aria-label="Next month">
              <MIcon.chev size={17} />
            </button>
          </div>
          <div className="cal-grid" style={{ paddingBottom: 0 }}>
            {DOWS.map((d) => (
              <span key={d} className="cal-dow">
                {d}
              </span>
            ))}
          </div>
          <div className="cal-grid" key={"g" + ym.y + "-" + ym.m}>
            {cells.map((d, i) => {
              if (!d) return <span key={"b" + i} />;
              const key = dateKey(ym.y, ym.m, d);
              const has = byDate[key];
              const isToday = ym.y === today.y && ym.m === today.m && d === today.d;
              return (
                <button
                  key={key}
                  className={"cal-day" + (has ? " has" : "") + (isToday ? " today" : "") + (selDate === key ? " is-sel" : "")}
                  onClick={has ? () => setSelDate(key) : undefined}
                  disabled={!has}
                >
                  {d}
                  {has && <span className="dot" />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="card" style={{ overflow: "hidden" }}>
          <div className="bk-side-title">{selLabel || "Pick a day"}</div>
          {dayItems.length === 0 ? (
            <p className="t-sub" style={{ padding: "4px 18px 18px" }}>
              {bookings.length ? "Days with a dot have bookings." : "Bookings the agent makes will show up here."}
            </p>
          ) : (
            <div style={{ padding: "2px 6px 8px" }}>
              {dayItems.map((b, i) => (
                <Fragment key={b.id}>
                  {i > 0 && <hr className="hair" style={{ marginLeft: 12 }} />}
                  <button
                    className="dk-row"
                    style={{ padding: "12px 12px" }}
                    onClick={() => b.leadId && openChat({ id: b.leadId, name: b.name, plate: b.plate, phone: b.phone })}
                  >
                    <span className="bk-time">{b.time}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="lead-name">{b.name}</div>
                      <div className="lead-meta">{[b.car, b.phone].filter(Boolean).join(" · ")}</div>
                    </div>
                    <span className="plate">{b.plate || "—"}</span>
                  </button>
                </Fragment>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type Settings = {
  auto_contact_enabled: boolean;
  daily_contact_cap: number;
  due_soon_days: number;
  sending_hours: { start: string; end: string };
  handoff_email: string | null;
};

const DEFAULTS: Settings = {
  auto_contact_enabled: false,
  daily_contact_cap: 20,
  due_soon_days: 30,
  sending_hours: { start: "09:00", end: "18:00" },
  handoff_email: null,
};

function fmtPhone(value: string): string {
  const digits = (value || "").replace(/\D/g, "");
  if (!digits) return "No number linked";
  return digits.startsWith("44")
    ? `+44 ${digits.slice(2, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`
    : `+${digits}`;
}

export function DeskSettingsScreen() {
  const { tenantId, garageName, garagePhone, waStatus, openModal, toast } = useDesk();
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [sending, setSending] = useState(false);
  const [outreachBusy, setOutreachBusy] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const outreachLoading = sending || outreachBusy;

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/engine/status?tenantId=${encodeURIComponent(tenantId)}`,
          { cache: "no-store" },
        );
        const data = await res.json();
        if (!cancelled) setOutreachBusy(Boolean(data.inProgress));
      } catch {
        if (!cancelled) setOutreachBusy(false);
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tenantId]);

  const sendOutreachNow = async () => {
    if (outreachLoading) return;
    if (
      !window.confirm(
        "Send WhatsApp outreach now to leads that are due and haven't been contacted yet? Customers already contacted are skipped automatically.",
      )
    ) {
      return;
    }
    setSending(true);
    toast("Sending outreach…");
    try {
      const res = await fetch("/api/engine/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error === "no_storage" ? "Storage unavailable" : "Couldn't send — try again");
        return;
      }
      toast(outreachResultMessage(data));
    } catch {
      toast("Couldn't send — try again");
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/settings?tenantId=${encodeURIComponent(tenantId)}`, { cache: "no-store" });
        const data = await res.json();
        if (!cancelled && data.settings) setS({ ...DEFAULTS, ...data.settings });
      } catch {
        /* defaults */
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [tenantId]);

  const update = (patch: Partial<Settings>) => {
    const next = { ...s, ...patch };
    setS(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, ...next }),
      }).catch(() => undefined);
    }, 600);
  };

  const waLabel = waStatus === "connected" ? "WhatsApp Business — connected" : "WhatsApp — reconnect";

  return (
    <div className="dk-screen">
      <div className="set-grid stagger">
        <div className="set-card row-between" style={{ gridColumn: "1 / -1" }}>
          <div className="row" style={{ minWidth: 0 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: waStatus === "connected" ? "var(--accent)" : "var(--danger)",
                flex: "0 0 auto",
              }}
            />
            <div>
              <div className="set-title">{waLabel}</div>
              <div className="set-sub mono">{fmtPhone(garagePhone)}</div>
            </div>
          </div>
          <button className="btn btn-ghost" onClick={() => openModal("wa")}>
            Manage
          </button>
        </div>

        <button
          type="button"
          className="set-card row-between set-card-tap"
          style={{ gridColumn: "1 / -1" }}
          onClick={() => {
            window.location.href = `/agent?edit=1&tenantId=${encodeURIComponent(tenantId)}`;
          }}
        >
          <div>
            <div className="set-title">Agent settings</div>
            <div className="set-sub">Tone, first message & instructions</div>
          </div>
          <MIcon.chev size={18} s={2.2} style={{ color: "var(--muted)", flexShrink: 0 }} />
        </button>

        <div className="set-card row-between">
          <div>
            <div className="set-title">Auto-contact leads</div>
            <div className="set-sub">The agent messages due-soon leads for you</div>
          </div>
          <Toggle on={s.auto_contact_enabled} onChange={(v) => update({ auto_contact_enabled: v })} />
        </div>

        <div className={"set-card row-between dimmable" + (s.auto_contact_enabled ? "" : " dim")}>
          <div>
            <div className="set-title">Daily cap</div>
            <div className="set-sub">New conversations per day</div>
          </div>
          <Stepper
            value={s.daily_contact_cap}
            onChange={(v) => update({ daily_contact_cap: v })}
            min={5}
            max={100}
            step={5}
            disabled={!s.auto_contact_enabled}
          />
        </div>

        <div className={"set-card dimmable" + (s.auto_contact_enabled ? "" : " dim")}>
          <div className="set-title" style={{ marginBottom: 2 }}>
            Due soon window
          </div>
          <div className="set-sub" style={{ marginBottom: 12 }}>
            How far ahead to message before the MOT is due
          </div>
          <Segmented
            options={WINDOW_OPTIONS}
            value={s.due_soon_days + "d"}
            onChange={(v) => update({ due_soon_days: parseInt(v, 10) })}
            disabled={!s.auto_contact_enabled}
          />
        </div>

        <div className={"set-card row-between dimmable" + (s.auto_contact_enabled ? "" : " dim")}>
          <div>
            <div className="set-title">Sending hours</div>
            <div className="set-sub">When messages go out</div>
          </div>
          <div className="row" style={{ gap: 7, flex: "0 0 auto" }}>
            <label className="field time-sm">
              <input
                value={s.sending_hours.start}
                onChange={(e) => update({ sending_hours: { ...s.sending_hours, start: e.target.value } })}
                aria-label="From"
              />
            </label>
            <span className="t-sub">–</span>
            <label className="field time-sm">
              <input
                value={s.sending_hours.end}
                onChange={(e) => update({ sending_hours: { ...s.sending_hours, end: e.target.value } })}
                aria-label="To"
              />
            </label>
          </div>
        </div>

        <div className="set-card row-between" style={{ gridColumn: "1 / -1" }}>
          <div style={{ minWidth: 0 }}>
            <div className="set-title">Send outreach now</div>
            <div className="set-sub">
              Automatic outreach runs once a day. Send to due, not-yet-contacted leads right now —
              already-contacted customers are skipped.
            </div>
          </div>
          <button
            type="button"
            className={"btn btn-send-outreach" + (outreachLoading ? " is-busy" : "")}
            onClick={() => void sendOutreachNow()}
            disabled={outreachLoading}
          >
            {outreachLoading ? "Sending outreach…" : "Send outreach now"}
          </button>
        </div>

        <div className="set-card" style={{ gridColumn: "1 / -1" }}>
          <div className="set-title">Handoff email</div>
          <div className="set-sub" style={{ marginBottom: 12 }}>
            Where alerts go when a customer needs a human
          </div>
          <label className="field" style={{ maxWidth: 380 }}>
            <MIcon.mail size={17} style={{ color: "var(--muted)" }} />
            <input
              type="email"
              placeholder="you@yourgarage.co.uk"
              value={s.handoff_email ?? ""}
              onChange={(e) => update({ handoff_email: e.target.value || null })}
            />
          </label>
        </div>

        <DeleteAccountSection tenantId={tenantId} garageName={garageName} toast={toast} variant="desktop" />
      </div>
    </div>
  );
}

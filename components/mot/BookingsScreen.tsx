"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { MIcon } from "./icons";
import { CountUp } from "./ui";
import { useApp } from "./context";
import { toBookingVM, type BookingVM } from "./data";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOWS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

const dateKey = (y: number, m: number, d: number) =>
  y + "-" + String(m + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");

/** Module-level cache so the day drawer can read the loaded month. */
let bookingsCache: BookingVM[] = [];
export function bookingsForDate(date: string): BookingVM[] {
  return bookingsCache.filter((b) => b.date === date);
}

export function BookingsScreen() {
  const { tenantId, openDay } = useApp();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [bookings, setBookings] = useState<BookingVM[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
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
      bookingsCache = vms;
    } finally {
      setLoading(false);
    }
  }, [tenantId, ym.m, ym.y]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const move = (delta: number) =>
    setYm(({ y, m }) => {
      const t = m + delta;
      return { y: y + Math.floor(t / 12), m: ((t % 12) + 12) % 12 };
    });

  const first = new Date(ym.y, ym.m, 1);
  const lead = (first.getDay() + 6) % 7; // Monday-start offset
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

  return (
    <div className="mt-scroll">
      <div className="mt-pad mt-content-wrap" style={{ paddingTop: 14, paddingBottom: 24 }}>
        <div className="bk-totals stagger">
          {(
            [
              ["Next 7 days", next7],
              ["This month", bookings.length],
              ["Total", bookings.length],
            ] as [string, number][]
          ).map(([l, n]) => (
            <div className="bk-total" key={l}>
              <div className="n">
                <CountUp value={n} />
              </div>
              <div className="l">{l}</div>
            </div>
          ))}
        </div>

        <div className="cal-head">
          <button className="iconbtn" onClick={() => move(-1)} aria-label="Previous month">
            <MIcon.back size={18} />
          </button>
          <span className="cal-title" key={ym.y + "-" + ym.m}>
            {MONTHS[ym.m]} {ym.y}
          </span>
          <button className="iconbtn" onClick={() => move(1)} aria-label="Next month">
            <MIcon.chev size={18} />
          </button>
        </div>

        <div className="cal-grid" style={{ marginBottom: 2 }}>
          {DOWS.map((d) => (
            <span key={d} className="cal-dow">
              {d}
            </span>
          ))}
        </div>

        <div className="cal-grid cal-month" key={"g" + ym.y + "-" + ym.m}>
          {cells.map((d, i) => {
            if (!d) return <span key={"b" + i}></span>;
            const key = dateKey(ym.y, ym.m, d);
            const has = byDate[key];
            const isToday = ym.y === today.y && ym.m === today.m && d === today.d;
            return (
              <button
                key={key}
                className={"cal-day" + (has ? " has" : "") + (isToday ? " today" : "")}
                onClick={has ? () => openDay(key) : undefined}
                disabled={!has}
              >
                {d}
                {has && <span className="dot"></span>}
              </button>
            );
          })}
        </div>

        {!loading && bookings.length === 0 && (
          <p className="t-sub" style={{ textAlign: "center", marginTop: 28 }}>
            Bookings the agent makes will show up here.
          </p>
        )}
        {loading && bookings.length === 0 && (
          <p className="t-sub" style={{ textAlign: "center", marginTop: 28 }}>
            Loading bookings…
          </p>
        )}
      </div>
    </div>
  );
}

/* ── day drawer ── */
export function DaySheet({ date, closing, onClose }: { date: string; closing: boolean; onClose: () => void }) {
  const { openChat } = useApp();
  const items = bookingsForDate(date);
  const [y, m, d] = date.split("-").map(Number);
  const label = new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <>
      <div className={"scrim" + (closing ? " closing" : "")} onClick={onClose}></div>
      <div className={"sheet auto" + (closing ? " closing" : "")}>
        <div className="row-between" style={{ padding: "22px 14px 6px 22px" }}>
          <h2 className="t-h2">{label}</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Close">
            <MIcon.close size={20} />
          </button>
        </div>
        <div style={{ padding: "0 20px 10px" }}>
          {items.map((b, i) => (
            <Fragment key={b.id}>
              {i > 0 && <hr className="hair" />}
              <button
                className="bk-row"
                style={{ width: "100%", padding: "14px 2px" }}
                onClick={() => {
                  onClose();
                  if (b.leadId) setTimeout(() => openChat({ id: b.leadId, name: b.name, plate: b.plate, phone: b.phone }), 200);
                }}
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
          {items.length === 0 && (
            <p className="t-sub" style={{ textAlign: "center", padding: "18px 0" }}>
              No bookings on this day.
            </p>
          )}
        </div>
      </div>
    </>
  );
}

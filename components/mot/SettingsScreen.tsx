"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MIcon } from "./icons";
import { Segmented, Stepper, Toggle } from "./ui";
import { useApp } from "./context";
import { WINDOW_OPTIONS } from "./data";
import { DeleteAccountSection } from "@/components/settings/DeleteAccountSection";

import type { ReactNode } from "react";

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

/** Friendly toast copy for a manual "send outreach now" result. */
export function outreachResultMessage(data: {
  sent?: number;
  skipped?: string | null;
  eligible?: number;
}): string {
  if ((data.sent ?? 0) > 0) {
    const n = data.sent ?? 0;
    return `Sent ${n} message${n === 1 ? "" : "s"} ✓`;
  }
  switch (data.skipped) {
    case "whatsapp_not_connected":
      return "Connect WhatsApp first";
    case "daily_cap_reached":
      return "Daily cap already reached for today";
    case "no_eligible_leads":
      return "No new leads due to contact right now";
    case "already_running":
      return "Outreach already in progress";
    case "not_found":
      return "Finish garage setup first";
    default:
      return "Nothing new to send right now";
  }
}

function SetRow({
  title,
  sub,
  right,
  children,
  dimmed,
  onClick,
}: {
  title: string;
  sub?: string;
  right?: ReactNode;
  children?: ReactNode;
  dimmed?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="row-between">
        <div style={{ minWidth: 0 }}>
          <div className="set-title">{title}</div>
          {sub && <div className="set-sub">{sub}</div>}
        </div>
        {right}
      </div>
      {children}
    </>
  );

  if (onClick) {
    return (
      <div
        role="button"
        tabIndex={0}
        className={"set-row set-row-tap dimmable" + (dimmed ? " dim" : "")}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        aria-disabled={dimmed || undefined}
      >
        {body}
      </div>
    );
  }

  return (
    <div className={"set-row dimmable" + (dimmed ? " dim" : "")} aria-disabled={dimmed || undefined}>
      {body}
    </div>
  );
}

export function SettingsScreen() {
  const router = useRouter();
  const { tenantId, garageName, toast } = useApp();
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
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
        "Send WhatsApp outreach now to leads that are due and haven't been contacted yet? Already-contacted customers are skipped automatically.",
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
      } finally {
        if (!cancelled) setLoaded(true);
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

  return (
    <div className="mt-scroll">
      <div className="mt-pad mt-content-wrap" style={{ paddingTop: 16, paddingBottom: 16 }}>
        <div className="card stagger" style={{ overflow: "hidden", opacity: loaded ? 1 : 0.6 }}>
          <SetRow
            title="Agent settings"
            sub="Tone, first message & instructions"
            onClick={() =>
              router.push(`/agent?edit=1&tenantId=${encodeURIComponent(tenantId)}`)
            }
            right={<MIcon.chev size={18} s={2.2} style={{ color: "var(--muted)", flexShrink: 0 }} />}
          />

          <hr className="hair" />

          <SetRow
            title="Auto-contact leads"
            right={<Toggle on={s.auto_contact_enabled} onChange={(v) => update({ auto_contact_enabled: v })} />}
          />

          <hr className="hair" />

          <SetRow
            title="Daily cap"
            dimmed={!s.auto_contact_enabled}
            right={
              <Stepper
                value={s.daily_contact_cap}
                onChange={(v) => update({ daily_contact_cap: v })}
                min={5}
                max={100}
                step={5}
                disabled={!s.auto_contact_enabled}
              />
            }
          />

          <hr className="hair" />

          <SetRow title="Due soon window" dimmed={!s.auto_contact_enabled}>
            <div style={{ marginTop: 12 }}>
              <Segmented
                options={WINDOW_OPTIONS}
                value={s.due_soon_days + "d"}
                onChange={(v) => update({ due_soon_days: parseInt(v, 10) })}
                disabled={!s.auto_contact_enabled}
              />
            </div>
          </SetRow>

          <hr className="hair" />

          <SetRow
            title="Sending hours"
            dimmed={!s.auto_contact_enabled}
            right={
              <div className="row" style={{ gap: 7, flex: "0 0 auto" }}>
                <label className="field time-sm">
                  <input
                    value={s.sending_hours.start}
                    onChange={(e) => update({ sending_hours: { ...s.sending_hours, start: e.target.value } })}
                    aria-label="From time"
                  />
                </label>
                <span className="t-sub">–</span>
                <label className="field time-sm">
                  <input
                    value={s.sending_hours.end}
                    onChange={(e) => update({ sending_hours: { ...s.sending_hours, end: e.target.value } })}
                    aria-label="To time"
                  />
                </label>
              </div>
            }
          />

          <hr className="hair" />

          <SetRow title="Handoff email">
            <label className="field" style={{ marginTop: 12, height: 44 }}>
              <MIcon.mail size={17} style={{ color: "var(--muted)" }} />
              <input
                type="email"
                placeholder="you@yourgarage.co.uk"
                value={s.handoff_email ?? ""}
                onChange={(e) => update({ handoff_email: e.target.value || null })}
              />
            </label>
          </SetRow>
        </div>

        <div className="card stagger" style={{ overflow: "hidden", marginTop: 16 }}>
          <SetRow
            title="Send outreach now"
            sub="Automatic outreach runs once a day. Only new, not-yet-contacted leads are messaged — no double texts."
          >
            <button
              type="button"
              className={"btn btn-send-outreach" + (outreachLoading ? " is-busy" : "")}
              onClick={() => void sendOutreachNow()}
              disabled={outreachLoading}
            >
              {outreachLoading ? "Sending outreach…" : "Send outreach now"}
            </button>
          </SetRow>
        </div>

        <div style={{ marginTop: 16 }}>
          <DeleteAccountSection tenantId={tenantId} garageName={garageName} toast={toast} variant="mobile" />
        </div>
      </div>
    </div>
  );
}

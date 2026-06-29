"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

/**
 * TEMPORARY: campaign control panel that proxies to a practice's legacy boxly
 * backend (/api/boxly/*). Lets Regent/NuYu control their LIVE agent today
 * (auto-trigger, reminders, lanes, send windows, webhook, prompt notes) exactly
 * like the old boxly dashboard. Remove once wasup-dental owns the orchestrator.
 */

type Stage = { name: string; count: number };
type Box = { name: string; total: number; stages: Stage[] };
type Window = { start: number; end: number };
type AutoFilter = { box?: string; stage?: string; windows?: Window[]; max_per_run?: number };
type ReactivationFilter = { box?: string; stage?: string };
type ScraperConfig = Record<string, { value: number; default: number }>;

type Banner = { ok: boolean; msg: string } | null;

export default function BoxlyConfigPanel({
  practiceId,
  practiceName,
}: {
  practiceId: string | null;
  practiceName: string;
}) {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Auto-trigger
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoFilters, setAutoFilters] = useState<AutoFilter[]>([]);
  const [outboundWindows, setOutboundWindows] = useState<Window[] | null>(null);
  const [autoBanner, setAutoBanner] = useState<Banner>(null);

  // Reminders
  const [remEnabled, setRemEnabled] = useState(false);
  const [remInterval, setRemInterval] = useState(24);
  const [remMax, setRemMax] = useState(3);
  const [remWebhook, setRemWebhook] = useState("");
  const [remSendWindow, setRemSendWindow] = useState<Window | null>(null);
  const [remBanner, setRemBanner] = useState<Banner>(null);

  // Priority lanes + reactivation
  const [lanes, setLanes] = useState<string[]>([]);
  const [reactivation, setReactivation] = useState<ReactivationFilter[]>([]);
  const [reactBanner, setReactBanner] = useState<Banner>(null);

  // Webhook + prompt notes
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookBanner, setWebhookBanner] = useState<Banner>(null);
  const [promptNotes, setPromptNotes] = useState("");
  const [promptBanner, setPromptBanner] = useState<Banner>(null);

  // Scraper performance
  const [scraper, setScraper] = useState<ScraperConfig | null>(null);
  const [scraperEdits, setScraperEdits] = useState<Record<string, number>>({});
  const [scraperBanner, setScraperBanner] = useState<Banner>(null);

  const [busy, setBusy] = useState<string | null>(null);

  const boxly = useCallback(
    async (path: string, opts: { method?: string; body?: unknown } = {}) => {
      if (!practiceId) throw new Error("no_practice");
      const res = await fetch(
        `/api/boxly/${path}?practiceId=${encodeURIComponent(practiceId)}`,
        {
          method: opts.method ?? "GET",
          headers: { "content-type": "application/json" },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          cache: "no-store",
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      return json;
    },
    [practiceId],
  );

  const loadAll = useCallback(async () => {
    if (!practiceId) return;
    setReady(false);
    setLoadError(null);
    try {
      const [boxesRes, auto, rem, laneRes, react, agent, notes, scr] = await Promise.all([
        boxly("leads/boxes").catch(() => []),
        boxly("agent/auto-config").catch(() => ({})),
        boxly("agent/reminder-config").catch(() => ({})),
        boxly("agent/priority-lanes").catch(() => ({})),
        boxly("scraper/reactivation-stages").catch(() => ({})),
        boxly("agent/config").catch(() => ({})),
        boxly("agent/prompt-notes").catch(() => ({})),
        boxly("scraper/config").catch(() => ({})),
      ]);

      setBoxes(Array.isArray(boxesRes) ? boxesRes : []);
      setAutoEnabled(Boolean(auto.enabled));
      setAutoFilters(Array.isArray(auto.filters) ? auto.filters : []);
      setOutboundWindows(Array.isArray(auto.outbound_active_windows) ? auto.outbound_active_windows : null);
      setRemEnabled(Boolean(rem.enabled));
      setRemInterval(Number(rem.interval_hours) || 24);
      setRemMax(Number(rem.max_count) || 3);
      setRemWebhook(rem.webhook_url || "");
      setRemSendWindow(rem.send_window || null);
      setLanes(Array.isArray(laneRes.lanes) ? laneRes.lanes : []);
      setReactivation(Array.isArray(react.filters) ? react.filters : []);
      setWebhookUrl(agent.webhook_url || "");
      setPromptNotes(notes.text || "");
      if (scr && typeof scr === "object" && !Array.isArray(scr)) {
        setScraper(scr as ScraperConfig);
        const edits: Record<string, number> = {};
        for (const [k, v] of Object.entries(scr as ScraperConfig)) edits[k] = v?.value;
        setScraperEdits(edits);
      }
      setReady(true);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load config");
      setReady(true);
    }
  }, [boxly, practiceId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // ─── Auto-trigger ──────────────────────────────────────────────────────────
  async function saveAuto(patch: { enabled?: boolean; filters?: AutoFilter[] }) {
    setBusy("auto");
    setAutoBanner(null);
    try {
      const res = await boxly("agent/auto-config", { method: "PUT", body: patch });
      setAutoEnabled(Boolean(res.enabled));
      if (Array.isArray(res.filters)) setAutoFilters(res.filters);
      setAutoBanner({ ok: true, msg: "Automation saved — live" });
    } catch (err) {
      setAutoBanner({ ok: false, msg: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setBusy(null);
    }
  }

  function autoSelected(box: string, stage: string) {
    return autoFilters.some((f) => f.box === box && f.stage === stage);
  }
  function toggleAuto(box: string, stage: string) {
    const next = autoSelected(box, stage)
      ? autoFilters.filter((f) => !(f.box === box && f.stage === stage))
      : [...autoFilters, { box, stage, windows: [{ start: 9, end: 21 }], max_per_run: 3 }];
    setAutoFilters(next);
    void saveAuto({ filters: next });
  }
  function updateAutoFilter(i: number, patch: Partial<AutoFilter>) {
    const next = autoFilters.map((f, idx) => (idx === i ? { ...f, ...patch } : f));
    setAutoFilters(next);
    void saveAuto({ filters: next });
  }

  // ─── Outbound windows ──────────────────────────────────────────────────────
  async function saveWindows(windows: Window[] | null) {
    setBusy("windows");
    try {
      await boxly("agent/auto-config", { method: "PUT", body: { outbound_active_windows: windows } });
      setOutboundWindows(windows);
      setAutoBanner({ ok: true, msg: "Send windows saved" });
    } catch (err) {
      setAutoBanner({ ok: false, msg: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setBusy(null);
    }
  }

  // ─── Reminders ─────────────────────────────────────────────────────────────
  async function saveReminders(patch: Record<string, unknown> = {}) {
    setBusy("reminders");
    setRemBanner(null);
    try {
      await boxly("agent/reminder-config", {
        method: "PUT",
        body: {
          enabled: remEnabled,
          interval_hours: remInterval,
          max_count: remMax,
          webhook_url: remWebhook,
          send_window: remSendWindow,
          ...patch,
        },
      });
      setRemBanner({ ok: true, msg: "Reminders saved — live" });
    } catch (err) {
      setRemBanner({ ok: false, msg: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setBusy(null);
    }
  }

  // ─── Priority lanes ────────────────────────────────────────────────────────
  async function saveLanes(next: string[]) {
    setLanes(next);
    setBusy("lanes");
    try {
      await boxly("agent/priority-lanes", { method: "PUT", body: { lanes: next } });
      setReactBanner({ ok: true, msg: "Priority lanes saved" });
    } catch (err) {
      setReactBanner({ ok: false, msg: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setBusy(null);
    }
  }
  function toggleLane(name: string) {
    saveLanes(lanes.includes(name) ? lanes.filter((n) => n !== name) : [...lanes, name]);
  }

  // ─── Reactivation columns ──────────────────────────────────────────────────
  async function saveReactivation(next: ReactivationFilter[]) {
    setReactivation(next);
    setBusy("react");
    try {
      await boxly("scraper/reactivation-stages", { method: "PUT", body: { filters: next } });
      setReactBanner({ ok: true, msg: "Reactivation filters saved" });
    } catch (err) {
      setReactBanner({ ok: false, msg: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setBusy(null);
    }
  }
  function reactSelected(box: string, stage: string) {
    return reactivation.some((f) => f.box === box && f.stage === stage);
  }
  function toggleReact(box: string, stage: string) {
    saveReactivation(
      reactSelected(box, stage)
        ? reactivation.filter((f) => !(f.box === box && f.stage === stage))
        : [...reactivation, { box, stage }],
    );
  }

  // ─── Webhook + prompt notes ────────────────────────────────────────────────
  async function saveWebhook() {
    setBusy("webhook");
    setWebhookBanner(null);
    try {
      await boxly("agent/config", { method: "PUT", body: { webhook_url: webhookUrl } });
      setWebhookBanner({ ok: true, msg: "Webhook saved" });
    } catch (err) {
      setWebhookBanner({ ok: false, msg: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setBusy(null);
    }
  }
  async function savePrompt() {
    setBusy("prompt");
    setPromptBanner(null);
    try {
      await boxly("agent/prompt-notes", { method: "PUT", body: { mode: "append", text: promptNotes } });
      setPromptBanner({ ok: true, msg: "Prompt notes saved" });
    } catch (err) {
      setPromptBanner({ ok: false, msg: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setBusy(null);
    }
  }

  // ─── Scraper performance ───────────────────────────────────────────────────
  async function saveScraper() {
    if (!scraper) return;
    setBusy("scraper");
    setScraperBanner(null);
    try {
      const payload: Record<string, number> = {};
      for (const [k, v] of Object.entries(scraperEdits)) {
        if (scraper[k] && v !== scraper[k].value) payload[k] = v;
      }
      if (Object.keys(payload).length === 0) {
        setScraperBanner({ ok: false, msg: "No changes to save" });
        return;
      }
      await boxly("scraper/config", { method: "PUT", body: payload });
      setScraperBanner({ ok: true, msg: "Scraper config saved" });
      void loadAll();
    } catch (err) {
      setScraperBanner({ ok: false, msg: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setBusy(null);
    }
  }

  // ─── Live actions (guarded) ────────────────────────────────────────────────
  async function runAction(label: string, path: string, body?: unknown) {
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        `${label}\n\nThis runs against the LIVE agent for ${practiceName} and may send real WhatsApp messages now. Continue?`,
      );
      if (!ok) return;
    }
    setBusy(path);
    try {
      const res = await boxly(path, { method: "POST", body });
      window.alert(`Done.\n\n${JSON.stringify(res, null, 2).slice(0, 600)}`);
      void loadAll();
    } catch (err) {
      window.alert(`Failed: ${err instanceof Error ? err.message : "error"}`);
    } finally {
      setBusy(null);
    }
  }

  if (!practiceId) {
    return <p className="text-sm text-ink/55">No practice selected.</p>;
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>Live controls.</strong> These settings drive {practiceName}&apos;s real agent via the
        existing automation backend. Saving takes effect on the next cron run; the action buttons can
        send real messages immediately.
      </div>

      {loadError && (
        <div className="rounded-2xl border border-red-300/60 bg-red-50 px-4 py-3 text-sm text-red-800">
          Couldn&apos;t reach the automation backend: {loadError}
        </div>
      )}

      {!ready && !loadError && <p className="text-sm text-ink/55">Loading live config…</p>}

      {ready && !loadError && (
        <>
          {/* Automation */}
          <Section
            title="Automation"
            subtitle="Send new leads in the selected box + stage to the agent automatically after each sync."
            action={<Toggle on={autoEnabled} disabled={busy === "auto"} onToggle={() => saveAuto({ enabled: !autoEnabled })} />}
          >
            {autoFilters.length > 0 ? (
              <div className="space-y-2">
                {autoFilters.map((f, i) => {
                  const w = f.windows?.[0] ?? { start: 9, end: 21 };
                  return (
                    <div key={`${f.box ?? "*"}-${f.stage ?? "*"}-${i}`} className="rounded-2xl border border-line bg-mist/40 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-ink">
                          {f.box || "Any box"} <span className="text-ink/40">/</span> {f.stage || "Any stage"}
                        </p>
                        <button
                          onClick={() => toggleAuto(f.box ?? "", f.stage ?? "")}
                          className="rounded-full px-2 py-1 text-xs font-semibold text-ink/50 hover:text-red-600"
                        >
                          Remove
                        </button>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        <LabeledNumber label="Start (h)" value={w.start} min={0} max={24} step={0.5}
                          onChange={(v) => updateAutoFilter(i, { windows: [{ ...w, start: v }] })} />
                        <LabeledNumber label="End (h)" value={w.end} min={0} max={24} step={0.5}
                          onChange={(v) => updateAutoFilter(i, { windows: [{ ...w, end: v }] })} />
                        <LabeledNumber label="Max/run" value={f.max_per_run ?? 3} min={1} max={100} step={1}
                          onChange={(v) => updateAutoFilter(i, { max_per_run: v })} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm italic text-ink/45">No automation lanes yet — pick a box + stage below.</p>
            )}

            <BoxStagePicker boxes={boxes} isSelected={autoSelected} onToggle={toggleAuto} />
            <Banner banner={autoBanner} />

            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              <ActionButton
                label="Run automation now"
                busy={busy === "agent/auto-trigger"}
                onClick={() => runAction("Run automation now", "agent/auto-trigger")}
              />
            </div>
          </Section>

          {/* Send windows */}
          <Section title="Send windows" subtitle="Only send outbound messages during these hours (UK time). Empty = workflow defaults.">
            <div className="space-y-2">
              {(outboundWindows ?? []).map((w, i) => (
                <div key={i} className="flex items-center gap-2 rounded-2xl border border-line bg-mist/40 p-3">
                  <span className="w-16 text-xs font-semibold text-ink/55">Window {i + 1}</span>
                  <input type="number" min={0} max={24} step={0.5} value={w.start}
                    onChange={(e) => setOutboundWindows((ws) => (ws ?? []).map((x, j) => (j === i ? { ...x, start: parseFloat(e.target.value) || 0 } : x)))}
                    className="w-20 rounded-xl border border-line bg-white px-2 py-1.5 text-sm outline-none focus:border-pine/40" />
                  <span className="text-xs text-ink/45">to</span>
                  <input type="number" min={0} max={24} step={0.5} value={w.end}
                    onChange={(e) => setOutboundWindows((ws) => (ws ?? []).map((x, j) => (j === i ? { ...x, end: parseFloat(e.target.value) || 0 } : x)))}
                    className="w-20 rounded-xl border border-line bg-white px-2 py-1.5 text-sm outline-none focus:border-pine/40" />
                  <button onClick={() => setOutboundWindows((ws) => (ws ?? []).filter((_, j) => j !== i))}
                    className="ml-auto rounded-full px-2 py-1 text-xs font-semibold text-ink/50 hover:text-red-600">Remove</button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setOutboundWindows((ws) => [...(ws ?? []), { start: 9, end: 18 }])}
                className="rounded-full border border-line bg-white px-3 py-2 text-xs font-semibold text-pine hover:border-pine">+ Add window</button>
              <button disabled={busy === "windows"} onClick={() => saveWindows(outboundWindows)}
                className="rounded-full bg-pine px-4 py-2 text-xs font-semibold text-lime disabled:opacity-50">Save windows</button>
              {outboundWindows && outboundWindows.length > 0 && (
                <button disabled={busy === "windows"} onClick={() => saveWindows(null)}
                  className="rounded-full border border-line bg-white px-3 py-2 text-xs font-semibold text-ink/55 hover:text-ink">Clear (defaults)</button>
              )}
            </div>
          </Section>

          {/* Reminders */}
          <Section
            title="Reminders"
            subtitle="Automatically follow up with leads that haven't responded."
            action={<Toggle on={remEnabled} disabled={busy === "reminders"} onToggle={() => { const next = !remEnabled; setRemEnabled(next); void saveReminders({ enabled: next }); }} />}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <LabeledNumber label="Interval (hours)" value={remInterval} min={1} max={168} step={1} onChange={setRemInterval} />
              <LabeledNumber label="Max reminders" value={remMax} min={1} max={20} step={1} onChange={setRemMax} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-ink/55">Reminder webhook (optional override)</label>
              <input type="url" value={remWebhook} onChange={(e) => setRemWebhook(e.target.value)}
                placeholder="Leave blank to use the main agent webhook"
                className="w-full rounded-2xl border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-pine/40" />
            </div>
            <div className="rounded-2xl border border-line bg-mist/40 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-ink">Send window</p>
                <Toggle on={Boolean(remSendWindow)} onToggle={() => setRemSendWindow(remSendWindow ? null : { start: 18, end: 21 })} />
              </div>
              {remSendWindow && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <LabeledNumber label="Start hour" value={remSendWindow.start} min={0} max={23} step={1}
                    onChange={(v) => setRemSendWindow((w) => ({ ...(w ?? { start: 18, end: 21 }), start: v }))} />
                  <LabeledNumber label="End hour" value={remSendWindow.end} min={0} max={23} step={1}
                    onChange={(v) => setRemSendWindow((w) => ({ ...(w ?? { start: 18, end: 21 }), end: v }))} />
                </div>
              )}
            </div>
            <Banner banner={remBanner} />
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              <button disabled={busy === "reminders"} onClick={() => saveReminders()}
                className="rounded-full bg-pine px-4 py-2 text-xs font-semibold text-lime disabled:opacity-50">Save reminders</button>
              <ActionButton label="Run reminders now" busy={busy === "agent/reminder-run"}
                onClick={() => runAction("Run reminders now", "agent/reminder-run")} />
            </div>
          </Section>

          {/* Priority lanes */}
          <Section title="Priority lanes" subtitle="Boxes prioritised for quick sync.">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {boxes.map((box) => {
                const on = lanes.includes(box.name);
                return (
                  <button key={box.name} disabled={busy === "lanes"} onClick={() => toggleLane(box.name)}
                    className={`rounded-2xl border px-3 py-2.5 text-left text-xs font-semibold transition ${on ? "border-pine bg-pine/10 text-pine" : "border-line bg-white text-ink hover:border-pine/40"}`}>
                    <span className="block truncate">{box.name}</span>
                    <span className="mt-0.5 block text-[10px] font-medium tabular-nums text-ink/45">{box.total} leads</span>
                  </button>
                );
              })}
            </div>
          </Section>

          {/* Reactivation */}
          <Section title="Reactivation columns" subtitle="Box + stage combos flagged for reactivation outreach.">
            <BoxStagePicker boxes={boxes} isSelected={reactSelected} onToggle={toggleReact} />
            <Banner banner={reactBanner} />
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              <ActionButton label="Apply to existing leads" busy={busy === "scraper/reactivation-stages/apply"}
                onClick={() => runAction("Apply reactivation to existing leads", "scraper/reactivation-stages/apply")} />
            </div>
          </Section>

          {/* Webhook */}
          <Section title="n8n webhook" subtitle="The workflow that receives leads for this practice.">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input type="url" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://your-n8n.app/webhook/…"
                className="flex-1 rounded-2xl border border-line bg-white px-3 py-2.5 font-mono text-sm outline-none focus:border-pine/40" />
              <button disabled={busy === "webhook"} onClick={saveWebhook}
                className="rounded-full bg-pine px-4 py-2.5 text-sm font-semibold text-lime disabled:opacity-50">Save</button>
            </div>
            <Banner banner={webhookBanner} />
          </Section>

          {/* Prompt notes */}
          <Section title="Prompt notes" subtitle="Extra instructions appended to the agent's system prompt.">
            <textarea value={promptNotes} onChange={(e) => setPromptNotes(e.target.value)} rows={6}
              placeholder="Additional instructions for the agent…"
              className="w-full rounded-2xl border border-line bg-white px-3 py-2.5 font-mono text-sm leading-relaxed outline-none focus:border-pine/40" />
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-ink/45">{promptNotes.length}/10,000 chars · appended</span>
              <button disabled={busy === "prompt"} onClick={savePrompt}
                className="rounded-full bg-pine px-4 py-2 text-xs font-semibold text-lime disabled:opacity-50">Save notes</button>
            </div>
            <Banner banner={promptBanner} />
          </Section>

          {/* Scraper performance */}
          {scraper && (
            <Section title="Scraper performance" subtitle="Fine-tune sync speed vs rate limiting.">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {Object.keys(scraper).map((key) => (
                  <LabeledNumber
                    key={key}
                    label={`${key} (default ${scraper[key].default})`}
                    value={scraperEdits[key] ?? scraper[key].value}
                    min={0}
                    max={60000}
                    step={1}
                    onChange={(v) => setScraperEdits((e) => ({ ...e, [key]: v }))}
                  />
                ))}
              </div>
              <Banner banner={scraperBanner} />
              <div className="border-t border-line pt-3">
                <button disabled={busy === "scraper"} onClick={saveScraper}
                  className="rounded-full bg-pine px-4 py-2 text-xs font-semibold text-lime disabled:opacity-50">Save config</button>
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Section({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4 rounded-[1.5rem] border border-line bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          {subtitle && <p className="mt-0.5 text-sm text-ink/55">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Toggle({ on, onToggle, disabled }: { on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:opacity-50 ${on ? "bg-pine" : "bg-ink/15"}`}
      aria-pressed={on}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

function LabeledNumber({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink/55">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(step < 1 ? parseFloat(e.target.value) || 0 : parseInt(e.target.value, 10) || 0)}
        className="w-full rounded-xl border border-line bg-white px-2 py-2 text-sm tabular-nums outline-none focus:border-pine/40"
      />
    </label>
  );
}

function Banner({ banner }: { banner: Banner }) {
  if (!banner) return null;
  return (
    <p className={`text-xs font-semibold ${banner.ok ? "text-pine" : "text-red-600"}`}>{banner.msg}</p>
  );
}

function ActionButton({ label, busy, onClick }: { label: string; busy: boolean; onClick: () => void }) {
  return (
    <button
      disabled={busy}
      onClick={onClick}
      className="rounded-full border border-amber-400/70 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 disabled:opacity-50"
    >
      {busy ? "Running…" : label}
    </button>
  );
}

function BoxStagePicker({
  boxes,
  isSelected,
  onToggle,
}: {
  boxes: Box[];
  isSelected: (box: string, stage: string) => boolean;
  onToggle: (box: string, stage: string) => void;
}) {
  if (boxes.length === 0) {
    return <p className="text-sm italic text-ink/45">No boxes found for this practice.</p>;
  }
  return (
    <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
      {boxes.map((box) => (
        <div key={box.name} className="overflow-hidden rounded-2xl border border-line bg-mist/30">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-sm font-semibold text-ink">{box.name}</span>
            <span className="text-xs tabular-nums text-ink/45">{box.total} leads</span>
          </div>
          <div className="flex flex-wrap gap-1.5 p-2">
            {box.stages.map((stage) => {
              const on = isSelected(box.name, stage.name);
              return (
                <button
                  key={stage.name}
                  onClick={() => onToggle(box.name, stage.name)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${on ? "bg-pine text-lime" : "border border-line bg-white text-ink hover:border-pine/40"}`}
                >
                  {on ? "✓ " : "+ "}
                  {stage.name}
                  <span className={on ? "opacity-75" : "opacity-45"}> ({stage.count})</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MIcon } from "@/components/mot/icons";
import { WhatsAppConnectPanel } from "@/components/connect/WhatsAppConnectPanel";
import { displayWaPhone } from "@/lib/wa-sheet-logic";
import {
  guessField,
  normalizeDate,
  normalizePhone,
  normalizeRegistration,
  parseCsv,
  type CsvField,
} from "@/lib/csv";
import { formatPlate } from "@/components/mot/data";
import type { ScanFinishRow } from "@/components/mot/context";
import type { ScanRow } from "@/lib/scan/types";
import type { ThreadChat } from "@/components/mot/ThreadScreen";
import { useDesk } from "./context";

type Msg = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  delivery_status: string | null;
  created_at: string;
};

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return "Today";
  if (same(d, yest)) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function displayPhone(value: string): string {
  const digits = (value || "").replace(/\D/g, "");
  if (!digits) return "No number linked";
  return digits.startsWith("44")
    ? `+44 ${digits.slice(2, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`
    : `+${digits}`;
}

/* ── thread drawer ── */
export function DeskThreadDrawer({ chat, closing }: { chat: ThreadChat; closing: boolean }) {
  const { tenantId, closeChat, toast, deleteLeads } = useDesk();
  const [thread, setThread] = useState<Msg[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const tTyping = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastInbound = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tel = (chat.phone || "").replace(/\s/g, "");
  const wa = tel.replace("+", "");

  const load = useCallback(async () => {
    if (!chat.leadId) {
      setLoaded(true);
      return;
    }
    try {
      const res = await fetch(`/api/chats/${chat.leadId}?tenantId=${encodeURIComponent(tenantId)}`, {
        cache: "no-store",
      });
      const data = await res.json();
      const msgs = (data.messages ?? []) as Msg[];
      setThread(msgs);
      setLoaded(true);

      const inbound = [...msgs].reverse().find((m) => m.direction === "inbound");
      if (inbound && inbound.id !== lastInbound.current) {
        const isFirstLoad = lastInbound.current === null;
        lastInbound.current = inbound.id;
        const last = msgs[msgs.length - 1];
        const fresh = Date.now() - new Date(inbound.created_at).getTime() < 90_000;
        if (!isFirstLoad && last?.direction === "inbound" && fresh) {
          setTyping(true);
          if (tTyping.current) clearTimeout(tTyping.current);
          tTyping.current = setTimeout(() => setTyping(false), 6000);
        }
      }
      if (msgs[msgs.length - 1]?.direction === "outbound") setTyping(false);
    } catch {
      /* keep current */
    }
  }, [chat.leadId, tenantId]);

  useEffect(() => {
    const t0 = window.setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), 5000);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
      if (tTyping.current) clearTimeout(tTyping.current);
    };
  }, [load]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.length, typing]);

  const send = async () => {
    const body = input.trim();
    if (!body || !chat.leadId || sending) return;
    setSending(true);
    setInput("");
    try {
      const res = await fetch(`/api/chats/${chat.leadId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, body }),
      });
      if (!res.ok) toast("Couldn't send — check the WhatsApp connection");
      await load();
    } finally {
      setSending(false);
    }
  };

  const items: ({ day: string } | Msg)[] = [];
  let lastDay = "";
  for (const m of thread) {
    const day = dayLabel(m.created_at);
    if (day !== lastDay) {
      items.push({ day });
      lastDay = day;
    }
    items.push(m);
  }
  let firstAgentSeen = false;

  return (
    <>
      <div className={"dk-scrim" + (closing ? " closing" : "")} onClick={closeChat} />
      <div className={"dk-drawer" + (closing ? " closing" : "")}>
        <div className="drawer-bar">
          <span className="plate">{chat.plate || "—"}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{chat.name}</div>
            <div style={{ fontSize: 11, color: "var(--on-pine-2)", marginTop: 1 }}>WhatsApp</div>
          </div>
          <button className="iconbtn on-dark" onClick={closeChat} aria-label="Close">
            <MIcon.close size={19} />
          </button>
          {chat.leadId && (
            <button
              className="iconbtn on-dark"
              onClick={() => void deleteLeads([chat.leadId!])}
              aria-label="Delete lead"
            >
              <MIcon.trash size={18} />
            </button>
          )}
        </div>

        <div className="drawer-scroll" ref={scrollRef}>
          <div className="thread-scroll">
            {!loaded && (
              <span className="day-pill">
                <MIcon.refresh size={11} s={2.4} className="spin" style={{ display: "inline-block", verticalAlign: "-1px", marginRight: 6 }} />
                Loading
              </span>
            )}
            {loaded && thread.length === 0 && <span className="day-pill">No messages yet</span>}
            {items.map((m, i) => {
              if ("day" in m) {
                return (
                  <span key={"d" + i} className="day-pill">
                    {m.day}
                  </span>
                );
              }
              const isAgent = m.direction === "outbound";
              const tagBefore = isAgent && !firstAgentSeen;
              if (isAgent) firstAgentSeen = true;
              return (
                <Fragment key={m.id}>
                  {tagBefore && <span className="agent-tag">Your agent</span>}
                  <div className={"bubble " + (isAgent ? "agent" : "cust")} style={{ animationDelay: Math.min(i * 60, 560) + "ms" }}>
                    {m.body}
                  </div>
                </Fragment>
              );
            })}
            {typing && (
              <div className="bubble cust" style={{ padding: "8px 13px" }}>
                <span className="typing">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            )}
          </div>
        </div>

        {chat.leadId ? (
          <div style={{ padding: "8px 14px 12px", boxShadow: "0 -1px 0 var(--line)" }}>
            <div className="row" style={{ gap: 8 }}>
              <label className="field" style={{ flex: 1, height: 40 }}>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void send()}
                  placeholder="Type to step in…"
                />
              </label>
              <button
                className="iconbtn"
                onClick={() => void send()}
                aria-label="Send"
                style={{
                  background: "var(--pine)",
                  color: "var(--on-pine)",
                  opacity: input.trim() && !sending ? 1 : 0.4,
                }}
              >
                <MIcon.send size={18} />
              </button>
            </div>
          </div>
        ) : null}

        <div style={{ padding: chat.leadId ? "0 18px 14px" : "6px 18px 14px", boxShadow: chat.leadId ? "none" : "0 -1px 0 var(--line)" }}>
          {chat.phone ? (
            <>
              <a className="call-row" href={"tel:" + tel}>
                <span className="call-ic">
                  <MIcon.phone size={17} />
                </span>
                <span style={{ flex: 1 }}>
                  <span className="lead-name" style={{ display: "block", fontSize: 13.5 }}>
                    Phone call
                  </span>
                  <span className="lead-meta">{chat.phone}</span>
                </span>
              </a>
              <hr className="hair" />
              <a className="call-row" href={"https://wa.me/" + wa} target="_blank" rel="noopener noreferrer">
                <span className="call-ic">
                  <MIcon.chat size={17} />
                </span>
                <span style={{ flex: 1 }}>
                  <span className="lead-name" style={{ display: "block", fontSize: 13.5 }}>
                    WhatsApp call
                  </span>
                  <span className="lead-meta">Opens WhatsApp — tap call there</span>
                </span>
              </a>
            </>
          ) : (
            <p className="t-sub" style={{ padding: "10px 2px" }}>
              No number on file — your agent handles replies.
            </p>
          )}
        </div>
      </div>
    </>
  );
}

/* ── lead editor drawer ── */
export function DeskEditorDrawer({ id, closing }: { id: string; closing: boolean }) {
  const { pending, updatePending, closeEdit, openEdit, toast } = useDesk();
  const idx = pending.findIndex((x) => x.id === id);
  const p = pending[idx];
  const next = pending[idx + 1];

  const [f, setF] = useState({
    plate: p?.plate ?? "",
    name: p?.hasName ? p.name : "",
    phone: p?.phone ?? "",
    motDueDate: p?.motDueDate ?? null as string | null,
    vehicle: p?.car || null as string | null,
  });
  type Chk = "loading" | { label: string; error?: boolean } | null;
  const [chk, setChk] = useState<Chk>(
    p?.motDueDate
      ? {
          label: new Date(p.motDueDate + "T00:00:00Z").toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
            timeZone: "UTC",
          }),
        }
      : null,
  );
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  useEffect(() => {
    const cur = pending.find((x) => x.id === id);
    const t = window.setTimeout(() => {
      setF({
        plate: cur?.plate ?? "",
        name: cur?.hasName ? cur.name : "",
        phone: cur?.phone ?? "",
        motDueDate: cur?.motDueDate ?? null,
        vehicle: cur?.car || null,
      });
      setChk(
        cur?.motDueDate
          ? {
              label: new Date(cur.motDueDate + "T00:00:00Z").toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
                timeZone: "UTC",
              }),
            }
          : null,
      );
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const set = (k: "plate" | "name" | "phone") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setF((x) => ({ ...x, [k]: v }));
    if (k === "plate") setChk(null);
  };

  const check = async () => {
    setChk("loading");
    ctrl.current?.abort();
    ctrl.current = new AbortController();
    try {
      const res = await fetch(`/api/vehicle/lookup?plate=${encodeURIComponent(f.plate.trim())}`, {
        signal: ctrl.current.signal,
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "lookup_failed");
      if (data.motExpiryDate) {
        const label = new Date(data.motExpiryDate + "T00:00:00Z").toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        });
        const vehicle = [data.colour, data.make].filter(Boolean).join(" ") || null;
        setChk({ label });
        setF((x) => ({ ...x, motDueDate: data.motExpiryDate, vehicle }));
      } else {
        setChk({ label: "No MOT record found", error: true });
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setChk({ label: "Lookup failed — try again", error: true });
    }
  };

  const save = () =>
    updatePending(id, {
      plate: f.plate.trim().toUpperCase(),
      name: f.name,
      phone: f.phone,
      motDueDate: f.motDueDate,
      vehicle: f.vehicle,
    });
  const done = () => {
    void save();
    closeEdit();
    toast("Saved");
  };
  const goNext = () => {
    void save();
    if (next) openEdit(next.id);
    else {
      closeEdit();
      toast("Saved");
    }
  };

  if (!p) return null;

  return (
    <>
      <div className={"dk-scrim" + (closing ? " closing" : "")} onClick={done} />
      <div className={"dk-drawer" + (closing ? " closing" : "")}>
        <div className="drawer-bar">
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Lead editor</div>
          </div>
          <span style={{ fontSize: 12, color: "var(--on-pine-2)", fontVariantNumeric: "tabular-nums" }}>
            {idx + 1} / {pending.length}
          </span>
          <button className="iconbtn on-dark" onClick={done} aria-label="Close">
            <MIcon.close size={19} />
          </button>
        </div>

        <div className="drawer-scroll">
          <div style={{ padding: "22px 20px", display: "flex", flexDirection: "column", gap: 15 }} key={id} className="stagger">
            <div className="row" style={{ gap: 8 }}>
              <label className="plate-field">
                <input value={f.plate} onChange={set("plate")} placeholder="AB12 CDE" aria-label="Plate" />
              </label>
              <button className="check-btn" disabled={!f.plate.trim() || chk === "loading"} onClick={() => void check()}>
                {chk === "loading" ? <MIcon.refresh size={16} className="spin" /> : "Check"}
              </button>
            </div>
            <div className="dvla-status">
              {chk === "loading" && <>Checking with DVLA…</>}
              {chk && chk !== "loading" && !chk.error && (
                <span className="badge badge-ok" style={{ fontSize: 12, padding: "6px 13px" }}>
                  <MIcon.check size={13} s={2.6} /> MOT due {chk.label}
                </span>
              )}
              {chk && chk !== "loading" && chk.error && (
                <span className="badge badge-overdue" style={{ fontSize: 12, padding: "6px 13px" }}>
                  {chk.label}
                </span>
              )}
              {!chk && <span style={{ color: "var(--faint)" }}>Check the plate to pull the MOT due date</span>}
            </div>
            <div>
              <label className="field-label" htmlFor="dke-name">
                Name
              </label>
              <label className="field">
                <input id="dke-name" value={f.name} onChange={set("name")} placeholder="Customer name" />
              </label>
            </div>
            <div>
              <label className="field-label" htmlFor="dke-phone">
                Mobile
              </label>
              <label className="field">
                <input id="dke-phone" type="tel" value={f.phone} onChange={set("phone")} placeholder="+44 7…" />
              </label>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 9, padding: "12px 18px 16px", boxShadow: "0 -1px 0 var(--line)" }}>
          <button className="btn btn-ghost btn-lg" onClick={done}>
            Done
          </button>
          <button className="btn btn-primary btn-lg" style={{ flex: 1 }} onClick={goNext}>
            {next ? (
              <>
                Next lead <MIcon.chev size={15} s={2.2} />
              </>
            ) : (
              "Save & close"
            )}
          </button>
        </div>
      </div>
    </>
  );
}

/* ── CSV modal ── */
const FIELD_OPTIONS: { id: CsvField; label: string }[] = [
  { id: "name", label: "Name" },
  { id: "registration", label: "Plate" },
  { id: "phone", label: "Phone" },
  { id: "due_date", label: "MOT due" },
  { id: "skip", label: "Ignore" },
];

export function DeskCsvModal({
  tenantId,
  closing,
  onClose,
  toast,
  onImported,
}: {
  tenantId: string;
  closing: boolean;
  onClose: () => void;
  toast: (msg: string) => void;
  onImported: (count: number) => void;
}) {
  type Stage = "pick" | "map" | "committing";
  const [stage, setStage] = useState<Stage>("pick");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<CsvField[]>([]);

  const onFile = async (file: File) => {
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length < 2) {
      toast("That file looks empty — needs a header row plus data");
      return;
    }
    const [head, ...data] = parsed;
    setHeaders(head);
    setRows(data);
    setMapping(head.map(guessField));
    setStage("map");
  };

  const preview = useMemo(() => {
    return rows.slice(0, 1000).flatMap((r) => {
      const lead: Record<string, string> = {};
      mapping.forEach((field, ci) => {
        if (field === "skip") return;
        const v = (r[ci] ?? "").trim();
        if (!v) return;
        lead[field] = lead[field] ? `${lead[field]} ${v}` : v;
      });
      const phone = normalizePhone(lead.phone ?? "");
      const reg = normalizeRegistration(lead.registration ?? "");
      if (!phone && !reg) return [];
      const nameParts = (lead.name ?? "").trim().split(/\s+/);
      return [
        {
          firstName: nameParts[0] || undefined,
          lastName: nameParts.slice(1).join(" ") || undefined,
          phone: phone ?? "",
          registration: reg || undefined,
          motDueDate: normalizeDate(lead.due_date ?? ""),
          source: "csv" as const,
          status: "queued" as const,
        },
      ];
    });
  }, [rows, mapping]);

  const commit = async () => {
    setStage("committing");
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, leads: preview }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "import_failed");
      onImported(data.inserted ?? preview.length);
    } catch {
      toast("Import failed. Nothing was saved — try again");
      setStage("map");
    }
  };

  return (
    <>
      <div className={"dk-scrim" + (closing ? " closing" : "")} onClick={onClose} />
      <div className={"dk-modal wide" + (closing ? " closing" : "")}>
        <div className="row-between" style={{ padding: "20px 14px 0 22px" }}>
          <h2 className="t-h2">Import leads from CSV</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Close">
            <MIcon.close size={19} />
          </button>
        </div>

        {stage === "pick" && (
          <label className="dropzone">
            <MIcon.file size={32} s={1.4} style={{ color: "var(--muted)" }} />
            <span className="dz-title">Choose a CSV file or drag it here</span>
            <span className="dz-sub">Any columns work. You&apos;ll match them up next</span>
            <input
              type="file"
              accept=".csv,text/csv"
              style={{ display: "none" }}
              onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])}
            />
          </label>
        )}

        {stage === "map" && (
          <div style={{ padding: "10px 22px 20px", overflowY: "auto", maxHeight: "calc(100vh - 180px)" }}>
            <p className="t-sub" style={{ marginBottom: 10 }}>
              {rows.length} rows found — check the column matching:
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {headers.map((h, ci) => (
                <div
                  key={ci}
                  className="row-between"
                  style={{
                    background: "var(--card-2)",
                    borderRadius: "var(--r-sm)",
                    padding: "9px 12px",
                    boxShadow: "inset 0 0 0 1px var(--line)",
                  }}
                >
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13.5, fontWeight: 500 }}>
                    {h || `Column ${ci + 1}`}
                    <span className="t-sub" style={{ display: "block", fontSize: 11.5 }}>
                      e.g. “{(rows[0]?.[ci] ?? "").slice(0, 22)}”
                    </span>
                  </span>
                  <select
                    value={mapping[ci]}
                    onChange={(e) => setMapping((m) => m.map((f, i) => (i === ci ? (e.target.value as CsvField) : f)))}
                    style={{
                      flex: "0 0 auto",
                      border: 0,
                      outline: 0,
                      background: "var(--card)",
                      boxShadow: "inset 0 0 0 1px var(--line)",
                      borderRadius: 999,
                      padding: "6px 10px",
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "var(--ink)",
                    }}
                  >
                    {FIELD_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <p className="t-sub" style={{ margin: "12px 2px" }}>
              <b style={{ color: "var(--ink)" }}>{preview.length}</b> rows ready · they go to the Approve queue
            </p>
            <button className="btn btn-primary btn-lg" disabled={preview.length === 0} onClick={() => void commit()}>
              Send {preview.length} to Approve <MIcon.chev size={16} s={2.2} />
            </button>
          </div>
        )}

        {stage === "committing" && (
          <div className="dvla-status" style={{ padding: "34px 0 40px" }}>
            <MIcon.refresh size={16} className="spin" /> Importing…
          </div>
        )}
      </div>
    </>
  );
}

/* ── add leads modal ── */
export function DeskAddModal({ closing, onClose }: { closing: boolean; onClose: () => void }) {
  const { addPending } = useDesk();
  const blank = { plate: "", name: "", phone: "" };
  const [f, setF] = useState(blank);
  const [added, setAdded] = useState(0);
  const set = (k: "plate" | "name" | "phone") => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const canAdd = f.plate.trim().length > 0 || f.phone.trim().length > 0;
  const add = () => {
    void addPending({ ...f, plate: formatPlate(f.plate) });
    setAdded((n) => n + 1);
    setF(blank);
    const el = document.getElementById("dka-plate");
    if (el) el.focus();
  };

  return (
    <>
      <div className={"dk-scrim" + (closing ? " closing" : "")} onClick={onClose} />
      <div className={"dk-modal" + (closing ? " closing" : "")}>
        <div className="row-between" style={{ padding: "20px 14px 0 22px" }}>
          <h2 className="t-h2">Add leads</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Close">
            <MIcon.close size={19} />
          </button>
        </div>
        <div style={{ padding: "14px 22px 20px", display: "flex", flexDirection: "column", gap: 11 }}>
          <label className="field">
            <input
              id="dka-plate"
              className="mono"
              value={f.plate}
              onChange={set("plate")}
              placeholder="Plate — AB12 CDE"
              style={{ textTransform: "uppercase" }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canAdd) add();
              }}
            />
          </label>
          <label className="field">
            <input
              value={f.name}
              onChange={set("name")}
              placeholder="Name"
              onKeyDown={(e) => {
                if (e.key === "Enter" && canAdd) add();
              }}
            />
          </label>
          <label className="field">
            <input
              type="tel"
              value={f.phone}
              onChange={set("phone")}
              placeholder="Mobile — +44 7…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && canAdd) add();
              }}
            />
          </label>
          <button className="btn btn-primary btn-lg" disabled={!canAdd} onClick={add}>
            <MIcon.plus size={16} /> Add{added > 0 ? " another" : " lead"}
          </button>
          {added > 0 && (
            <p className="t-sub" style={{ textAlign: "center" }} key={added}>
              <span className="num-bump" style={{ color: "var(--pine)", fontWeight: 600, display: "inline-block" }}>
                {added} added
              </span>{" "}
              — they&apos;re waiting in Approve
            </p>
          )}
        </div>
      </div>
    </>
  );
}

/* ── scan register modal ── */
type ScanPage = {
  id: number;
  pageIndex: number;
  status: "scanning" | "done" | "error";
  rows: ScanFinishRow[];
};

let scanPageId = 0;

const SCAN_ACCEPT = "image/png,image/jpeg,.png,.jpg,.jpeg";

function isScanImage(file: File): boolean {
  const mime = (file.type || "").toLowerCase();
  if (mime === "image/png" || mime === "image/jpeg" || mime === "image/jpg") return true;
  return /\.(png|jpe?g)$/i.test(file.name || "");
}

export function DeskScanModal({ closing, onClose }: { closing: boolean; onClose: () => void }) {
  const { finishScan, toast } = useDesk();
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [drag, setDrag] = useState(false);
  const pageIndexRef = useRef(0);

  const processFile = (file: File) => {
    if (!isScanImage(file)) {
      toast("Use PNG or JPG page images only");
      return;
    }
    const id = ++scanPageId;
    const pageIndex = pageIndexRef.current++;
    setPages((p) => [...p, { id, pageIndex, status: "scanning", rows: [] }]);
    const form = new FormData();
    form.append("file", file, file.name || "page.jpg");
    fetch("/api/scan", { method: "POST", body: form })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          if (data.error === "unsupported_format") throw new Error("format");
          throw new Error(data.error ?? "scan_failed");
        }
        const rows = ((data.rows ?? []) as ScanRow[]).map((r, rowIndex) => ({
          name: r.name,
          plate: r.plate,
          phone: r.phone,
          pageIndex,
          rowIndex: typeof r.rowIndex === "number" ? r.rowIndex : rowIndex,
        }));
        setPages((p) => p.map((pg) => (pg.id === id ? { ...pg, status: "done", rows } : pg)));
      })
      .catch((err) => {
        setPages((p) => p.map((pg) => (pg.id === id ? { ...pg, status: "error" } : pg)));
        toast(err instanceof Error && err.message === "format" ? "PNG or JPG only" : "Couldn't read that page — try a sharper shot");
      });
  };

  const onFiles = (files: FileList | null) => {
    if (!files) return;
    [...files].forEach((f) => processFile(f));
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    onFiles(e.dataTransfer.files);
  };

  const scanning = pages.filter((p) => p.status === "scanning").length;
  const rowsDone = pages.filter((p) => p.status === "done").reduce((a, p) => a + p.rows.length, 0);
  const allRows = () =>
    pages
      .slice()
      .sort((a, b) => a.pageIndex - b.pageIndex)
      .flatMap((p) => p.rows.slice().sort((a, b) => (a.rowIndex ?? 0) - (b.rowIndex ?? 0)));

  return (
    <>
      <div className={"dk-scrim" + (closing ? " closing" : "")} onClick={onClose} />
      <div className={"dk-modal" + (closing ? " closing" : "")}>
        <div className="row-between" style={{ padding: "20px 14px 0 22px" }}>
          <h2 className="t-h2">Upload scans</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Close">
            <MIcon.close size={19} />
          </button>
        </div>
        <p className="t-sub" style={{ padding: "6px 22px 0" }}>
          Upload PNG or JPG photos of the day book — keep adding while earlier pages process.
        </p>
        <label
          className={"dropzone" + (drag ? " drag" : "")}
          style={{ marginBottom: 10, padding: "28px 24px" }}
          onDragEnter={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
        >
          <input
            type="file"
            accept={SCAN_ACCEPT}
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              onFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <MIcon.upload size={28} s={1.5} style={{ color: "var(--muted)" }} />
          <span className="dz-title">Upload page images</span>
          <span className="dz-sub">PNG or JPG — click or drag files here</span>
        </label>
        {pages.length > 0 && (
          <div style={{ padding: "0 22px", maxHeight: 200, overflowY: "auto" }}>
            {pages.map((pg, i) => (
              <Fragment key={pg.id}>
                {i > 0 && <hr className="hair" />}
                <div className="scan-pg">
                  <span className="pgthumb" />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Page {i + 1}</span>
                  <span className={"st" + (pg.status === "done" ? " done" : "")}>
                    {pg.status === "done" ? (
                      <>
                        <MIcon.check size={13} s={2.6} /> {pg.rows.length} rows
                      </>
                    ) : pg.status === "error" ? (
                      <>Failed</>
                    ) : (
                      <>
                        <MIcon.refresh size={13} className="spin" /> scanning…
                      </>
                    )}
                  </span>
                </div>
              </Fragment>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 9, padding: "14px 22px 20px" }}>
          <button className="btn btn-ghost btn-lg" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary btn-lg"
            style={{ flex: 1 }}
            disabled={pages.length === 0}
            onClick={() => finishScan(allRows(), true)}
          >
            {scanning > 0 ? `Send to Approve · ${scanning} still scanning` : `Send ${rowsDone} rows to Approve`}
          </button>
        </div>
      </div>
    </>
  );
}

/* ── WhatsApp modal ── */
type ConnectIntent = "reconnect" | "new" | "change";
type PendingAction = "disconnect" | "change" | null;

export function DeskWaModal({
  tenantId,
  garageName,
  instanceId,
  phone,
  closing,
  onClose,
  toast,
  onStatus,
  onRefresh,
}: {
  tenantId: string;
  garageName?: string;
  instanceId: string | null;
  phone: string;
  closing: boolean;
  onClose: () => void;
  toast: (msg: string) => void;
  onStatus: (connected: boolean) => void;
  onRefresh: () => void;
}) {
  const [status, setStatus] = useState<"checking" | "connected" | "disconnected">("checking");
  const [connectIntent, setConnectIntent] = useState<ConnectIntent | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [busy, setBusy] = useState(false);

  const checkStatus = useCallback(async () => {
    if (!instanceId) {
      setStatus("disconnected");
      onStatus(false);
      return;
    }
    setStatus("checking");
    try {
      const res = await fetch(
        `/api/wasup/status?instanceId=${encodeURIComponent(instanceId)}&tenantId=${encodeURIComponent(
          tenantId,
        )}&mode=qr&phone=${encodeURIComponent(phone)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        setStatus("disconnected");
        onStatus(false);
        return;
      }
      const data = await res.json();
      const connected = data.status === "connected";
      setStatus(connected ? "connected" : "disconnected");
      onStatus(connected);
    } catch {
      setStatus("disconnected");
      onStatus(false);
    }
  }, [instanceId, onStatus, phone, tenantId]);

  useEffect(() => {
    const t = window.setTimeout(() => void checkStatus(), 0);
    return () => clearTimeout(t);
  }, [checkStatus]);

  const runDisconnect = async (changeNumber: boolean) => {
    setBusy(true);
    try {
      const res = await fetch("/api/wasup/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, changeNumber }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "wasup_clear_failed" || data.error === "wasup_delete_failed") {
          toast("Couldn't reach Wasup to disconnect — try again in a moment");
        } else {
          toast(changeNumber ? "Couldn't change number — try again" : "Couldn't disconnect — try again");
        }
        return;
      }
      onRefresh();
      onStatus(false);
      setStatus("disconnected");
      setPendingAction(null);
      if (changeNumber) {
        toast("WhatsApp unlinked — enter your new number");
        setConnectIntent("change");
      } else {
        toast("WhatsApp disconnected");
      }
    } catch {
      toast(changeNumber ? "Couldn't change number — try again" : "Couldn't disconnect — try again");
    } finally {
      setBusy(false);
    }
  };

  const openChangeNumber = () => {
    if (status === "connected") {
      setPendingAction("change");
      return;
    }
    setConnectIntent("change");
  };

  if (connectIntent) {
    const panelPhone = connectIntent === "reconnect" ? phone : "";
    return (
      <>
        <div className={"dk-scrim" + (closing ? " closing" : "")} onClick={onClose} />
        <div
          className={"dk-modal" + (closing ? " closing" : "")}
          style={{ padding: 0, overflow: "hidden", width: "min(480px, 94vw)", maxHeight: "90vh", display: "flex", flexDirection: "column" }}
        >
          <WhatsAppConnectPanel
            key={connectIntent}
            tenantId={tenantId}
            garageName={garageName}
            initialPhone={panelPhone}
            reconnectInstanceId={connectIntent === "reconnect" ? instanceId : null}
            forcePhoneStep={connectIntent === "change" || connectIntent === "new" || connectIntent === "reconnect"}
            fixedLinkMode="qr"
            variant="embedded"
            onBack={() => {
              setConnectIntent(null);
              void checkStatus();
            }}
            doneLabel="Done"
            onConnected={() => {
              onRefresh();
              onStatus(true);
              setStatus("connected");
              setConnectIntent(null);
            }}
          />
        </div>
      </>
    );
  }

  if (pendingAction) {
    const isChange = pendingAction === "change";
    return (
      <>
        <div className={"dk-scrim" + (closing ? " closing" : "")} onClick={onClose} />
        <div className={"dk-modal" + (closing ? " closing" : "")}>
          <div className="row-between" style={{ padding: "20px 14px 0 22px" }}>
            <h2 className="t-h2">{isChange ? "Change number?" : "Disconnect?"}</h2>
            <button className="iconbtn" onClick={() => setPendingAction(null)} aria-label="Back">
              <MIcon.back size={19} />
            </button>
          </div>
          <div style={{ padding: "22px 22px 8px" }}>
            <p className="t-sub" style={{ margin: 0, lineHeight: 1.55 }}>
              {isChange
                ? "This logs out WhatsApp, removes the current instance, and clears the linked number. You'll pair a new number next."
                : "This logs out WhatsApp on the server. Your instance stays — scan again anytime to reconnect."}
            </p>
            <div className="mono" style={{ fontSize: 13, color: "var(--muted)", marginTop: 14 }}>
              {displayWaPhone(phone)}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9, padding: "12px 22px 22px" }}>
            <button
              className="btn btn-primary btn-lg"
              style={isChange ? { background: "var(--danger)", borderColor: "var(--danger)" } : undefined}
              disabled={busy}
              onClick={() => void runDisconnect(isChange)}
            >
              {busy ? <MIcon.refresh size={17} className="spin" /> : isChange ? "Yes, change number" : "Yes, disconnect"}
            </button>
            <button className="btn btn-ghost btn-lg" onClick={() => setPendingAction(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className={"dk-scrim" + (closing ? " closing" : "")} onClick={onClose} />
      <div className={"dk-modal" + (closing ? " closing" : "")}>
        <div className="row-between" style={{ padding: "20px 14px 0 22px" }}>
          <h2 className="t-h2">WhatsApp</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Close">
            <MIcon.close size={19} />
          </button>
        </div>

        <div style={{ textAlign: "center", padding: "26px 32px 6px" }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: status === "connected" ? "var(--tint)" : "var(--danger-bg)",
              color: status === "connected" ? "var(--pine)" : "var(--danger)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
            }}
          >
            {status === "checking" ? (
              <MIcon.refresh size={26} s={2.2} className="spin" />
            ) : status === "connected" ? (
              <MIcon.check size={26} s={2.2} />
            ) : (
              <MIcon.close size={24} s={2.2} />
            )}
          </div>
          <div style={{ fontSize: 17, fontWeight: 600 }}>
            {!instanceId
              ? "Setup required"
              : status === "checking"
                ? "Checking…"
                : status === "connected"
                  ? "Connected"
                  : "Not connected"}
          </div>
          <div className="mono" style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>
            {instanceId ? displayWaPhone(phone) : "Link WhatsApp to send and receive lead messages"}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 9, padding: "20px 22px 20px" }}>
          {instanceId ? (
            <>
              <button className="btn btn-primary btn-lg" onClick={() => setConnectIntent("reconnect")} disabled={busy}>
                Reconnect
              </button>
              <button className="btn btn-ghost btn-lg" onClick={openChangeNumber} disabled={busy}>
                Change number
              </button>
              {(status === "connected" || phone) && (
                <button className="btn btn-ghost btn-lg" onClick={() => setPendingAction("disconnect")} disabled={busy}>
                  Disconnect
                </button>
              )}
            </>
          ) : (
            <button className="btn btn-primary btn-lg" onClick={() => setConnectIntent("new")}>
              Connect WhatsApp
            </button>
          )}
        </div>
      </div>
    </>
  );
}

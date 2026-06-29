"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { MIcon } from "./icons";
import { Empty } from "./ui";
import { useApp } from "./context";
import { formatPlate } from "./data";
import {
  duplicateGroups,
  duplicateReviewMap,
  duplicateTabCounts,
  filterByDuplicateTab,
  type DuplicateTab,
} from "./duplicate-review";

export function ApproveScreen() {
  const { pending, approve, reject, openEdit, openAdd } = useApp();
  const [sel, setSel] = useState<string[]>([]);
  const [tab, setTab] = useState<DuplicateTab>("all");
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const clearSel = (ids: string[]) => setSel((s) => s.filter((x) => !ids.includes(x)));
  const duplicates = useMemo(() => duplicateReviewMap(pending), [pending]);
  const counts = useMemo(() => duplicateTabCounts(pending), [pending]);
  const visible = useMemo(() => filterByDuplicateTab(pending, tab), [pending, tab]);
  const groups = useMemo(() => duplicateGroups(pending, tab), [pending, tab]);
  const keepOnly = (groupIds: string[], keepId: string) => {
    const rejectIds = groupIds.filter((id) => id !== keepId);
    if (rejectIds.length) void reject(rejectIds);
    setSel((s) => s.filter((id) => !rejectIds.includes(id)));
  };

  return (
    <>
      <div className="mt-scroll">
        {pending.length === 0 ? (
          <div style={{ paddingTop: 56 }}>
            <Empty icon={<MIcon.check size={32} s={1.5} />} title="All clear">
              Scanned leads wait here for a quick check before they go live.
            </Empty>
          </div>
        ) : (
          <div className="mt-pad mt-content-wrap" style={{ paddingTop: 14, paddingBottom: 110 }}>
            <div className="dup-tabs" role="tablist" aria-label="Approve filters">
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
              <div className="dup-groups">
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
                      {i > 0 && <hr className="hair" style={{ marginLeft: 13 }} />}
                      <div className="ap-row">
                        <button
                          className={"sel" + (sel.includes(p.id) ? " on" : "")}
                          onClick={() => toggle(p.id)}
                          aria-label="Select"
                        >
                          <MIcon.check size={13} s={3} />
                        </button>
                        <button className="row" style={{ flex: 1, minWidth: 0, gap: 11 }} onClick={() => openEdit(p.id)}>
                          <span className="plate">{p.plate || "-"}</span>
                          <span style={{ minWidth: 0 }}>
                            <span className="lead-name" style={{ display: "block" }}>
                              {p.hasName ? p.name : <span className="ap-missing">No name</span>}
                              {dupe && (
                                <span className="dup-badge" title={dupe.detail}>
                                  {dupe.label}
                                </span>
                              )}
                            </span>
                            <span className="lead-meta" style={{ display: "block" }}>
                              {p.phone || <span className="ap-missing">No number</span>}
                            </span>
                          </span>
                        </button>
                        <button
                          className="ap-act yes"
                          onClick={() => {
                            void approve([p.id]);
                            clearSel([p.id]);
                          }}
                          aria-label="Approve"
                        >
                          <MIcon.check size={16} s={2.4} />
                        </button>
                        <button
                          className="ap-act no"
                          onClick={() => {
                            void reject([p.id]);
                            clearSel([p.id]);
                          }}
                          aria-label="Reject"
                        >
                          {!p.hasName && !p.phone ? <MIcon.trash size={15} s={2} /> : <MIcon.close size={15} s={2.4} />}
                        </button>
                      </div>
                    </Fragment>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {sel.length > 0 ? (
        <div className="ap-bar">
          <button
            className="btn btn-ghost"
            style={{ flex: "0 0 auto", width: "auto", padding: "0 18px" }}
            onClick={() => {
              void reject(sel);
              setSel([]);
            }}
          >
            Reject
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              void approve(sel);
              setSel([]);
            }}
          >
            Approve {sel.length}
          </button>
        </div>
      ) : (
        <div className="fabs">
          <button className="fab-round primary" onClick={openAdd} aria-label="Add lead manually">
            <MIcon.plus size={22} />
          </button>
        </div>
      )}
    </>
  );
}

/* ── lead editor (pushed layer) — DVLA check is real ── */
export function EditLeadScreen({ id }: { id: string }) {
  const { pending, updatePending, closeEdit, openEdit } = useApp();
  const idx = pending.findIndex((x) => x.id === id);
  const p = pending[idx];
  const next = pending[idx + 1];

  const [f, setF] = useState({
    plate: p?.plate ?? "",
    name: p?.hasName ? p.name : "",
    phone: p?.phone ?? "",
    motDueDate: p?.motDueDate ?? null,
    vehicle: p?.car || null,
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

  /* re-seed form when jumping to the next lead */
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
    const controller = new AbortController();
    ctrl.current = controller;
    // Client-side safety net: never let the "checking…" state spin forever,
    // even if the network stalls before the server's own 12s timeout fires.
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(`/api/vehicle/lookup?plate=${encodeURIComponent(f.plate.trim())}`, {
        signal: controller.signal,
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
      const e = err as Error;
      // A manual re-check (new controller) aborts the previous request — ignore.
      if (e.name === "AbortError" && ctrl.current !== controller) return;
      const msg = e.message === "dvla_timeout" || e.name === "AbortError"
        ? "DVLA timed out — try again"
        : e.message === "dvla_unreachable"
          ? "Can't reach DVLA — try again"
          : "Lookup failed — try again";
      setChk({ label: msg, error: true });
    } finally {
      clearTimeout(timeout);
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
  const goBack = () => {
    void save();
    closeEdit(true);
  };
  const goNext = () => {
    void save();
    if (next) openEdit(next.id);
    else closeEdit(true);
  };

  if (!p) return null;

  return (
    <>
      <div className="thread-bar">
        <button className="iconbtn on-dark" onClick={goBack} aria-label="Back">
          <MIcon.back size={21} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="t-h3" style={{ color: "var(--on-pine)" }}>
            Lead editor
          </div>
        </div>
        <span style={{ fontSize: 12, color: "var(--on-pine-2)", fontVariantNumeric: "tabular-nums" }}>
          {idx + 1} / {pending.length}
        </span>
      </div>

      <div className="mt-scroll">
        <div className="mt-pad stagger" key={id} style={{ paddingTop: 26, display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="row" style={{ gap: 9 }}>
            <label className="plate-field">
              <input value={f.plate} onChange={set("plate")} placeholder="AB12 CDE" aria-label="Plate" />
            </label>
            <button className="check-btn" disabled={!f.plate.trim() || chk === "loading"} onClick={() => void check()}>
              {chk === "loading" ? <MIcon.refresh size={17} className="spin" /> : "Check"}
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
              <span className="badge badge-overdue" style={{ fontSize: 12, padding: "6px 13px" }}>{chk.label}</span>
            )}
            {!chk && <span style={{ color: "var(--faint)" }}>Check the plate to pull the MOT due date</span>}
          </div>

          <div>
            <label className="field-label" htmlFor="ed-name">
              Name
            </label>
            <label className="field">
              <input id="ed-name" value={f.name} onChange={set("name")} placeholder="Customer name" />
            </label>
          </div>
          <div>
            <label className="field-label" htmlFor="ed-phone">
              Mobile
            </label>
            <label className="field">
              <input id="ed-phone" type="tel" value={f.phone} onChange={set("phone")} placeholder="+44 7…" />
            </label>
          </div>
        </div>
      </div>

      <div className="edit-foot">
        <button className="btn btn-ghost" style={{ flex: "0 0 auto", width: "auto", padding: "0 24px" }} onClick={goBack}>
          Back
        </button>
        <button className="btn btn-primary" onClick={goNext}>
          {next ? (
            <>
              Next lead <MIcon.chev size={16} s={2.2} />
            </>
          ) : (
            "Done"
          )}
        </button>
      </div>
    </>
  );
}

/* ── add leads manually (sheet, keeps accepting entries) ── */
export function AddSheet({ closing, onClose }: { closing: boolean; onClose: () => void }) {
  const { addPending } = useApp();
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
    const el = document.getElementById("add-plate");
    if (el) el.focus();
  };

  return (
    <>
      <div className={"scrim" + (closing ? " closing" : "")} onClick={onClose}></div>
      <div className={"sheet auto" + (closing ? " closing" : "")}>
        <div className="row-between" style={{ padding: "22px 14px 4px 22px" }}>
          <h2 className="t-h2">Add leads</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Close">
            <MIcon.close size={20} />
          </button>
        </div>
        <div style={{ padding: "10px 20px 8px", display: "flex", flexDirection: "column", gap: 12 }}>
          <label className="field">
            <input
              id="add-plate"
              className="mono"
              value={f.plate}
              onChange={set("plate")}
              placeholder="Plate — AB12 CDE"
              style={{ textTransform: "uppercase" }}
            />
          </label>
          <label className="field">
            <input value={f.name} onChange={set("name")} placeholder="Name" />
          </label>
          <label className="field">
            <input type="tel" value={f.phone} onChange={set("phone")} placeholder="Mobile — +44 7…" />
          </label>
          <button
            className="btn btn-primary"
            disabled={!canAdd}
            style={!canAdd ? { opacity: 0.4, pointerEvents: "none" } : undefined}
            onClick={add}
          >
            <MIcon.plus size={17} /> Add{added > 0 ? " another" : " lead"}
          </button>
          {added > 0 && (
            <p className="t-sub" style={{ textAlign: "center" }} key={added}>
              <span className="num-bump" style={{ color: "var(--pine)", fontWeight: 600 }}>
                {added} added
              </span>{" "}
              — keep going or close
            </p>
          )}
        </div>
      </div>
    </>
  );
}

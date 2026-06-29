"use client";

import { Fragment, useState } from "react";
import { MIcon } from "./icons";
import { Empty } from "./ui";
import { useApp, type Filter } from "./context";
import type { LeadVM } from "./data";

const FILTER_STATE: Record<Exclude<Filter, "All">, string> = {
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

function LeadRow({
  lead,
  selected,
  onToggle,
  onOpen,
  onDelete,
}: {
  lead: LeadVM;
  selected: boolean;
  onToggle: (id: string) => void;
  onOpen: (l: LeadVM) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="ap-row">
      <button className={"sel" + (selected ? " on" : "")} onClick={() => onToggle(lead.id)} aria-label="Select">
        <MIcon.check size={13} s={3} />
      </button>
      <button className="row lead-row" style={{ flex: 1, minWidth: 0, gap: 12, padding: 0 }} onClick={() => onOpen(lead)}>
        <span className="plate">{lead.plate || "—"}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="lead-name" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {lead.name}
            {lead.contacted && <MIcon.ticks size={15} s={2} className="ticks" style={{ color: "var(--muted)" }} />}
          </div>
          <div className="lead-meta">{[lead.car, lead.due].filter(Boolean).join(" · ")}</div>
        </div>
        <span className={"badge " + badgeCls(lead.state)}>{lead.badge}</span>
      </button>
      <button className="ap-act no" onClick={() => onDelete(lead.id)} aria-label="Delete lead">
        <MIcon.trash size={15} s={2} />
      </button>
    </div>
  );
}

export function LeadsScreen() {
  const { leads, filter, openChat, openCsv, openScan, loading, deleteLeads } = useApp();
  const [sel, setSel] = useState<string[]>([]);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const clearSel = (ids: string[]) => setSel((s) => s.filter((x) => !ids.includes(x)));

  const shown =
    filter === "All" ? leads : leads.filter((l) => l.state === FILTER_STATE[filter as Exclude<Filter, "All">]);

  return (
    <>
      <div className="mt-scroll">
        {leads.length === 0 ? (
          <div className="mt-empty-shell">
            {loading ? (
              <div className="dvla-status">
                <MIcon.refresh size={16} className="spin" /> Loading leads…
              </div>
            ) : (
              <div className="mt-empty-panel">
                <Empty icon={<MIcon.clip size={32} s={1.5} />} title="No leads yet">
                  Scan the day book or import a CSV and we&apos;ll sort your customers by MOT due date.
                </Empty>
                <div className="mt-empty-actions">
                  <button className="btn btn-ghost" onClick={openCsv}>
                    <MIcon.upload size={18} /> Import CSV
                  </button>
                  <button className="btn btn-primary" onClick={openScan}>
                    <MIcon.cam size={18} /> Take photos
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-pad mt-content-wrap" style={{ paddingTop: 16, paddingBottom: sel.length > 0 ? 110 : 96 }}>
            <div className="card" style={{ overflow: "hidden" }} key={filter}>
              <div className="stagger">
                {shown.map((l, i) => (
                  <Fragment key={l.id}>
                    {i > 0 && <hr className="hair" style={{ marginLeft: 13 }} />}
                    <LeadRow
                      lead={l}
                      selected={sel.includes(l.id)}
                      onToggle={toggle}
                      onOpen={(lead) => openChat({ id: lead.id, name: lead.name, plate: lead.plate, phone: lead.phone })}
                      onDelete={(id) => {
                        void deleteLeads([id]);
                        clearSel([id]);
                      }}
                    />
                  </Fragment>
                ))}
                {shown.length === 0 && (
                  <p className="t-sub" style={{ textAlign: "center", padding: "26px 0" }}>
                    Nothing under “{filter}” right now.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {sel.length > 0 ? (
        <div className="ap-bar">
          <button
            className="btn btn-ghost"
            style={{ flex: "0 0 auto", width: "auto", padding: "0 18px", color: "var(--danger)" }}
            onClick={() => {
              void deleteLeads(sel);
              setSel([]);
            }}
          >
            Delete {sel.length}
          </button>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setSel([])}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="fabs">
          <button className="fab-round ghost" onClick={openCsv} aria-label="Import CSV">
            <MIcon.upload size={20} />
          </button>
          <button className="fab-round primary" onClick={openScan} aria-label="Take photos">
            <MIcon.cam size={23} />
          </button>
        </div>
      )}
    </>
  );
}

"use client";

import { useMemo, useState } from "react";
import { MIcon } from "./icons";
import {
  guessField,
  normalizeDate,
  normalizePhone,
  normalizeRegistration,
  parseCsv,
  type CsvField,
} from "@/lib/csv";

type Props = {
  tenantId: string;
  closing: boolean;
  onClose: () => void;
  toast: (msg: string) => void;
  onImported: (count: number) => void;
};

const FIELD_OPTIONS: { id: CsvField; label: string }[] = [
  { id: "name", label: "Name" },
  { id: "registration", label: "Plate" },
  { id: "phone", label: "Phone" },
  { id: "due_date", label: "MOT due" },
  { id: "skip", label: "Ignore" },
];

type Stage = "pick" | "map" | "committing";

/** CSV import sheet — dropzone → column mapping → rows land in Approve. */
export function CsvSheet({ tenantId, closing, onClose, toast, onImported }: Props) {
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
      <div className={"scrim" + (closing ? " closing" : "")} onClick={onClose}></div>
      <div className={"sheet auto" + (closing ? " closing" : "")} style={{ maxHeight: "86%" }}>
        <div className="row-between" style={{ padding: "22px 14px 0 22px" }}>
          <h2 className="t-h2">Import leads from CSV</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Close">
            <MIcon.close size={20} />
          </button>
        </div>

        {stage === "pick" && (
          <label className="dropzone" style={{ cursor: "pointer" }}>
            <MIcon.file size={34} s={1.4} style={{ color: "var(--muted)" }} />
            <span className="dz-title">Choose a CSV file</span>
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
          <div style={{ padding: "10px 20px 8px", overflowY: "auto" }}>
            <p className="t-sub" style={{ marginBottom: 10 }}>
              {rows.length} rows found — check the column matching:
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {headers.map((h, ci) => (
                <div key={ci} className="row-between" style={{ background: "var(--card-2)", borderRadius: "var(--r-sm)", padding: "9px 12px", boxShadow: "inset 0 0 0 1px var(--line)" }}>
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
              <b style={{ color: "var(--ink)" }}>{preview.length}</b> rows ready · they go to the Approve queue, plates get
              checked with DVLA
            </p>
            <button
              className="btn btn-primary"
              disabled={preview.length === 0}
              style={preview.length === 0 ? { opacity: 0.4, pointerEvents: "none" } : undefined}
              onClick={() => void commit()}
            >
              Send {preview.length} to Approve <MIcon.chev size={16} s={2.2} />
            </button>
          </div>
        )}

        {stage === "committing" && (
          <div className="dvla-status" style={{ padding: "34px 0 40px" }}>
            <MIcon.refresh size={16} className="spin" /> Importing &amp; checking plates with DVLA…
          </div>
        )}
      </div>
    </>
  );
}

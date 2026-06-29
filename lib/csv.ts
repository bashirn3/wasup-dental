/** Minimal CSV parser: handles quoted fields, escaped quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export type CsvField = "name" | "registration" | "phone" | "due_date" | "skip";

/** Guess which lead field a CSV column holds from its header. */
export function guessField(header: string): CsvField {
  const h = header.toLowerCase();
  if (/(reg|plate|vrm|vehicle)/.test(h)) return "registration";
  if (/(phone|mobile|tel|number)/.test(h)) return "phone";
  if (/(due|expiry|expires|mot)/.test(h)) return "due_date";
  if (/(name|customer|client|contact)/.test(h)) return "name";
  return "skip";
}

/** Normalise UK phone to E.164 (+44...). Returns null when implausible. */
export function normalizePhone(raw: string): string | null {
  let d = (raw || "").replace(/[^\d+]/g, "");
  if (!d) return null;
  if (d.startsWith("+")) d = d.slice(1);
  if (d.startsWith("0044")) d = "44" + d.slice(4);
  else if (d.startsWith("0")) d = "44" + d.slice(1);
  else if (!d.startsWith("44")) {
    // National format without leading 0 — UK mobile (7…) or geographic (1…/2…)
    if (d.length >= 10 && d.length <= 11 && /^[127]/.test(d)) d = "44" + d;
  }
  if (!/^44\d{9,11}$/.test(d)) return null;
  return "+" + d;
}

/** Normalise a date string (UK formats or ISO) to YYYY-MM-DD. */
export function normalizeDate(raw: string): string | null {
  const s = (raw || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (m) {
    const [, d, mo, yRaw] = m;
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

export function normalizeRegistration(raw: string): string {
  return (raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

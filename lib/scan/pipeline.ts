import { applyRule, bandFor, guessFieldType, worstBand } from "./classify";
import type { AnalyzeOutput } from "./doc-intel";
import { classifyRowWithLlm } from "./llm-fallback";
import type { Band, FieldType, RawToken, ReconciledField, ScanRow } from "./types";

const FIELDS: FieldType[] = ["name", "plate", "phone"];

/** Turn a normalised DI output into reconciled, banded scan rows. */
export async function buildRows(out: AnalyzeOutput): Promise<ScanRow[]> {
  const grouped = out.tableRows?.length ? rowsFromTable(out) : rowsFromWords(out);

  const rows: ScanRow[] = [];
  for (let i = 0; i < grouped.length; i++) {
    const row = await buildScanRow(grouped[i], i);
    if (row) rows.push(row);
  }
  return rows;
}

interface FieldTokens {
  name: RawToken[];
  plate: RawToken[];
  phone: RawToken[];
}

function emptyTokens(): FieldTokens {
  return { name: [], plate: [], phone: [] };
}

// --- table path ---------------------------------------------------------------
function rowsFromTable(out: AnalyzeOutput): FieldTokens[] {
  const header = resolveHeaderMap(out);
  const result: FieldTokens[] = [];
  const dataRows = (out.tableRows ?? []).filter((r) =>
    r.some((c) => (c.rowIndex ?? 0) > 0),
  );
  for (const cells of dataRows) {
    const ft = emptyTokens();
    for (const cell of cells) {
      if (!cell.content) continue;
      const field = header[cell.columnIndex ?? -1] ?? guessFieldType(cell.content);
      ft[field].push(cell);
    }
    if (ft.name.length || ft.plate.length || ft.phone.length) result.push(ft);
  }
  return result;
}

function resolveHeaderMap(out: AnalyzeOutput): Record<number, FieldType> {
  const map: Record<number, FieldType> = {};
  const raw = out.headerMap ?? {};
  for (const [col, guess] of Object.entries(raw)) {
    if (guess === "name" || guess === "plate" || guess === "phone") {
      map[Number(col)] = guess;
    }
  }
  // Infer unknown columns by majority vote over their data cells.
  const colTokens = new Map<number, string[]>();
  for (const cells of out.tableRows ?? []) {
    for (const c of cells) {
      if ((c.rowIndex ?? 0) === 0) continue;
      const ci = c.columnIndex ?? -1;
      const arr = colTokens.get(ci) ?? [];
      if (c.content) arr.push(c.content);
      colTokens.set(ci, arr);
    }
  }
  for (const [ci, tokens] of colTokens) {
    if (map[ci]) continue;
    const votes: Record<FieldType, number> = { name: 0, plate: 0, phone: 0 };
    for (const t of tokens) votes[guessFieldType(t)]++;
    map[ci] = (Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] as FieldType) ?? "name";
  }
  return map;
}

// --- read (freeform) path -----------------------------------------------------
// Handwritten registers have no ruled grid: columns are separated only by
// whitespace and the photo is usually skewed. We (1) de-skew using the detected
// page angle, (2) cluster words into physical rows along the axis perpendicular
// to the text direction, then (3) split each row positionally:
//   name  = leading alphabetic token(s) before the first digit token
//   phone = the trailing long digit-run (>= 7 digits)
//   plate = whatever sits between the name and the phone
function rowsFromWords(out: AnalyzeOutput): FieldTokens[] {
  const all = out.words ?? [];
  if (!all.length) return [];

  const W = out.page.width || 1000;
  const digitsOf = (s: string) => cleanupAscii(s).replace(/\D/g, "");

  // 1) drop noise: page-edge bleed from the facing page, low-confidence specks,
  //    and non-Latin glyphs. Always keep long digit runs (phones).
  const words = all.filter((w) => {
    const clean = cleanupAscii(w.content);
    if (!clean) return false;
    const isPhoneish = digitsOf(w.content).length >= 8;
    if (isPhoneish) return true;
    if (midX(w.polygon) < W * 0.07) return false; // facing-page margin bleed
    if ((w.confidence ?? 0) < 0.5) return false; // faint specks / reflections
    return true;
  });
  if (!words.length) return [];

  // 2) de-skew using the detected text angle (handles tilts up to ~±40°).
  const theta = ((out.pageAngle ?? 0) * Math.PI) / 180;
  const sin = Math.sin(theta),
    cos = Math.cos(theta);
  const along = (w: RawToken) => midX(w.polygon) * cos + midY(w.polygon) * sin;
  const perp = (w: RawToken) => -midX(w.polygon) * sin + midY(w.polygon) * cos;

  const heights = words
    .map((w) => polyHeight(w.polygon))
    .filter((h) => h > 0)
    .sort((a, b) => a - b);
  const medH = heights.length ? heights[Math.floor(heights.length / 2)] : out.page.height * 0.02;
  const rowGap = Math.max(out.page.height * 0.025, medH * 0.45);

  // 3) cluster into rows by perpendicular distance.
  const sorted = [...words].sort((a, b) => perp(a) - perp(b));
  const clusters: RawToken[][] = [];
  let cur: RawToken[] = [];
  let lastPerp = Number.NEGATIVE_INFINITY;
  for (const w of sorted) {
    const p = perp(w);
    if (cur.length && p - lastPerp > rowGap) {
      clusters.push(cur);
      cur = [];
    }
    cur.push(w);
    lastPerp = p;
  }
  if (cur.length) clusters.push(cur);

  // 4) positional split per row.
  return clusters.map((cluster) => {
    const ordered = [...cluster].sort((a, b) => along(a) - along(b));
    const ft = emptyTokens();

    // phone = right-most token carrying a long digit run
    let phoneIdx = -1;
    for (let i = ordered.length - 1; i >= 0; i--) {
      if (digitsOf(ordered[i].content).length >= 7) {
        phoneIdx = i;
        break;
      }
    }
    // first token that contains a digit marks where the plate begins
    let firstDigit = ordered.findIndex((t) => /\d/.test(cleanupAscii(t.content)));
    if (firstDigit === -1) firstDigit = ordered.length;

    ordered.forEach((tok, i) => {
      if (i === phoneIdx) {
        ft.phone.push(tok);
        return;
      }
      if (i < firstDigit) {
        // leading run → name only if it's actually alphabetic
        if (/[A-Za-z]/.test(cleanupAscii(tok.content))) ft.name.push(tok);
        return;
      }
      ft.plate.push(tok); // middle column
    });
    return ft;
  });
}

// --- reconcile a single row ---------------------------------------------------
async function buildScanRow(ft: FieldTokens, index: number): Promise<ScanRow | null> {
  const fields: ReconciledField[] = [];
  const values: Record<FieldType, string> = { name: "", plate: "", phone: "" };
  const confidence: Record<FieldType, number> = { name: 0, plate: 0, phone: 0 };

  for (const type of FIELDS) {
    const toks = ft[type];
    if (!toks.length) continue;
    const ocrValue = toks.map((t) => t.content).join(" ").trim();
    const ocrConf = avg(toks.map((t) => t.confidence));
    const rule = applyRule(type, ocrValue);
    const conf = combineConfidence(ocrConf, rule.ruleConfidence);

    fields.push({
      type,
      value: rule.value,
      ocrValue,
      ocrConfidence: round(ocrConf),
      ruleConfidence: rule.ruleConfidence,
      confidence: conf,
      band: bandFor(conf),
      note: rule.corrected ? rule.note ?? "Auto-normalised" : rule.note,
    });
    values[type] = rule.value;
    confidence[type] = conf;
  }

  if (!fields.length) return null;

  // LLM fallback only for rows rules couldn't resolve (a red field).
  const hasRed = fields.some((f) => f.band === "red");
  if (hasRed) {
    const tokens = FIELDS.flatMap((t) => ft[t].map((x) => x.content));
    const llm = await classifyRowWithLlm(tokens);
    if (llm) {
      for (const f of fields) {
        if (f.band !== "red") continue;
        const v = llm[f.type];
        if (v && v.trim()) {
          const rule = applyRule(f.type, v);
          f.value = rule.value || v;
          f.ruleConfidence = Math.max(f.ruleConfidence, 0.8);
          f.confidence = combineConfidence(f.ocrConfidence, f.ruleConfidence);
          f.band = bandFor(f.confidence);
          f.note = "Resolved via AI fallback";
          values[f.type] = f.value;
          confidence[f.type] = f.confidence;
        }
      }
    }
  }

  const band: Band = worstBand(fields.map((f) => f.band));

  // Drop phantom / empty rows.
  if (!isPlausibleLead(values)) return null;

  return {
    id: crypto.randomUUID(),
    rowIndex: index,
    name: values.name,
    plate: values.plate,
    phone: values.phone,
    fields,
    confidence,
    band,
  };
}

/**
 * A row is a real lead only if it carries a phone OR a (plate + name). This keeps
 * blank ruled lines and stray reflections from becoming rows, while never
 * dropping a genuine row that has a phone number.
 */
function isPlausibleLead(values: Record<FieldType, string>): boolean {
  const plateAlnum = (values.plate || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const hasPlausiblePlate =
    plateAlnum.length >= 4 &&
    plateAlnum.length <= 9 &&
    /[0-9]/.test(plateAlnum) &&
    /[A-Z]/.test(plateAlnum);

  const phoneDigits = (values.phone || "").replace(/\D/g, "").length;
  const strayDigits = (values.plate || "").replace(/\D/g, "").length;
  const hasPlausiblePhone = phoneDigits >= 9 || (!hasPlausiblePlate && strayDigits >= 9);

  const hasName = (values.name || "").replace(/[^A-Za-z]/g, "").length >= 2;

  return hasPlausiblePhone || (hasPlausiblePlate && hasName);
}

// --- helpers ------------------------------------------------------------------
const midX = (p: number[]) =>
  (Math.min(p[0], p[2], p[4], p[6]) + Math.max(p[0], p[2], p[4], p[6])) / 2;
const midY = (p: number[]) =>
  (Math.min(p[1], p[3], p[5], p[7]) + Math.max(p[1], p[3], p[5], p[7])) / 2;
const polyHeight = (p: number[]) =>
  p.length >= 8 ? Math.max(p[1], p[3], p[5], p[7]) - Math.min(p[1], p[3], p[5], p[7]) : 0;
const cleanupAscii = (s: string) =>
  (s || "").normalize("NFKD").replace(/[^\x20-\x7E]/g, "").trim();
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const round = (n: number) => Math.round(n * 1000) / 1000;
const combineConfidence = (ocr: number, rule: number) => Math.round(ocr * rule * 1000) / 1000;

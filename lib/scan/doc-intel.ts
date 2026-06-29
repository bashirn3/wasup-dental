import type { RawToken } from "./types";

export const DI_API_VERSION = "2024-11-30";
export type ModelId = "prebuilt-layout" | "prebuilt-read";

export interface AnalyzeOutput {
  modelId: ModelId;
  apiVersion: string;
  page: { width: number; height: number; unit: string };
  /** detected text rotation in degrees (clockwise), used to de-skew rows */
  pageAngle?: number;
  /** structured rows from layout tables, when available */
  tableRows?: RawToken[][];
  /** header map columnIndex -> field guess, when a table header is present */
  headerMap?: Record<number, string>;
  /** flat words from read model (fallback) */
  words?: RawToken[];
}

/**
 * Submit a document to Azure Document Intelligence and poll until the
 * long-running operation completes, then normalise the response.
 */
export async function analyzeDocument(
  base64Source: string,
  modelId: ModelId = "prebuilt-layout",
  opts: { highRes?: boolean } = {},
): Promise<AnalyzeOutput> {
  const endpoint = process.env.AZURE_DOC_INTEL_ENDPOINT;
  const key = process.env.AZURE_DOC_INTEL_KEY;
  if (!endpoint || !key) throw new Error("doc_intel_not_configured");

  const params = new URLSearchParams({ "api-version": DI_API_VERSION });
  if (opts.highRes) params.set("features", "ocrHighResolution");

  const submitUrl = `${endpoint.replace(/\/+$/, "")}/documentintelligence/documentModels/${modelId}:analyze?${params}`;

  const submit = await fetch(submitUrl, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ base64Source }),
  });

  if (submit.status !== 202) {
    const text = await submit.text();
    throw new Error(`DI submit failed (${submit.status}): ${text.slice(0, 500)}`);
  }

  const opLocation = submit.headers.get("operation-location");
  if (!opLocation) throw new Error("DI submit: missing Operation-Location header");

  // Poll ~1.5s, timeout ~90s.
  const deadline = Date.now() + 90_000;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let result: any = null;
  while (Date.now() < deadline) {
    await sleep(1500);
    const poll = await fetch(opLocation, {
      headers: { "Ocp-Apim-Subscription-Key": key },
    });
    if (!poll.ok) {
      const text = await poll.text();
      throw new Error(`DI poll failed (${poll.status}): ${text.slice(0, 300)}`);
    }
    const json = await poll.json();
    if (json.status === "succeeded") {
      result = json.analyzeResult;
      break;
    }
    if (json.status === "failed") {
      throw new Error(`DI analysis failed: ${JSON.stringify(json.error ?? {}).slice(0, 300)}`);
    }
  }
  if (!result) throw new Error("DI poll timed out (status stuck in running)");

  return normalise(result, modelId);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalise(analyzeResult: any, modelId: ModelId): AnalyzeOutput {
  const page = analyzeResult?.pages?.[0] ?? {};
  const pageInfo = {
    width: page.width ?? 1000,
    height: page.height ?? 1400,
    unit: page.unit ?? "pixel",
  };

  if (modelId === "prebuilt-layout" && Array.isArray(analyzeResult?.tables) && analyzeResult.tables.length) {
    const table = analyzeResult.tables[0];
    // DI layout cells often omit per-cell confidence; derive it from the
    // word-level OCR confidences that DI does populate, so banding is real.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const words: { cx: number; cy: number; conf: number }[] = (page.words ?? []).map((w: any) => {
      const p = w.polygon ?? [];
      return { cx: (p[0] + p[4]) / 2, cy: (p[1] + p[5]) / 2, conf: w.confidence ?? 0.9 };
    });
    const byRow = new Map<number, RawToken[]>();
    for (const cell of table.cells ?? []) {
      const poly = cell.boundingRegions?.[0]?.polygon ?? [];
      const tok: RawToken = {
        content: (cell.content ?? "").trim(),
        confidence: typeof cell.confidence === "number" ? cell.confidence : cellConfidence(poly, words),
        polygon: poly,
        rowIndex: cell.rowIndex,
        columnIndex: cell.columnIndex,
      };
      const arr = byRow.get(cell.rowIndex) ?? [];
      arr.push(tok);
      byRow.set(cell.rowIndex, arr);
    }
    const rowIdxs = [...byRow.keys()].sort((a, b) => a - b);
    const headerMap: Record<number, string> = {};
    if (rowIdxs.length) {
      for (const h of byRow.get(rowIdxs[0]) ?? []) {
        if (h.columnIndex !== undefined) headerMap[h.columnIndex] = guessHeader(h.content);
      }
    }
    const tableRows = rowIdxs.map((ri) =>
      (byRow.get(ri) ?? []).sort((a, b) => (a.columnIndex ?? 0) - (b.columnIndex ?? 0)),
    );
    return { modelId, apiVersion: DI_API_VERSION, page: pageInfo, tableRows, headerMap };
  }

  // read fallback (or layout with no tables)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const words: RawToken[] = (page.words ?? []).map((w: any) => ({
    content: (w.content ?? "").trim(),
    confidence: w.confidence ?? 0.9,
    polygon: w.polygon ?? [],
  }));
  // Estimate the text-baseline skew from the widest detected lines. This is far
  // more reliable than page.angle for photos taken at a perspective angle.
  const skew = estimateSkew(page.lines ?? [], pageInfo.width);
  const pageAngle = skew ?? (typeof page.angle === "number" ? page.angle : undefined);
  return { modelId, apiVersion: DI_API_VERSION, page: pageInfo, pageAngle, words };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function estimateSkew(lines: any[], pageWidth: number): number | undefined {
  const angles: { deg: number; w: number }[] = [];
  for (const ln of lines) {
    const p = ln.polygon ?? [];
    if (p.length < 8) continue;
    const dx = p[2] - p[0];
    const dy = p[3] - p[1];
    const w = Math.hypot(dx, dy);
    if (w < pageWidth * 0.22) continue; // only wide, data-bearing lines
    angles.push({ deg: (Math.atan2(dy, dx) * 180) / Math.PI, w });
  }
  if (!angles.length) return undefined;
  // width-weighted median
  angles.sort((a, b) => a.deg - b.deg);
  const total = angles.reduce((s, a) => s + a.w, 0);
  let acc = 0;
  for (const a of angles) {
    acc += a.w;
    if (acc >= total / 2) return a.deg;
  }
  return angles[angles.length - 1].deg;
}

/** Average confidence of the OCR words whose centre falls inside a cell. */
function cellConfidence(poly: number[], words: { cx: number; cy: number; conf: number }[]): number {
  if (poly.length < 8 || !words.length) return 0.9;
  const xs = [poly[0], poly[2], poly[4], poly[6]];
  const ys = [poly[1], poly[3], poly[5], poly[7]];
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const inside = words.filter((w) => w.cx >= minX && w.cx <= maxX && w.cy >= minY && w.cy <= maxY);
  if (!inside.length) return 0.9;
  return inside.reduce((a, w) => a + w.conf, 0) / inside.length;
}

function guessHeader(content: string): string {
  const c = content.toLowerCase();
  if (/(reg|plate|vehicle|veh)/.test(c)) return "plate";
  if (/(phone|mobile|tel|number|contact|no\.?)/.test(c)) return "phone";
  if (/(name|customer|client)/.test(c)) return "name";
  return "unknown";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

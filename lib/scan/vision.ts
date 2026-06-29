import { formatPlate } from "@/components/mot/data";
import { normalizePhone } from "@/lib/csv";
import { applyRule, bandFor } from "./classify";
import type { FieldType, ReconciledField, ScanRow } from "./types";

export type VisionExtractRow = {
  name: string;
  plate: string;
  phone: string;
};

const SYSTEM_PROMPT = `You read UK garage MOT day-book pages photographed on a phone.
Each row is usually: registration plate, customer name, mobile number — but handwriting varies and columns may be missing.

Return ONLY JSON:
{"rows":[{"name":"","plate":"","phone":""}]}

Rules:
- Extract EVERY plausible customer row on the page (skip blank ruled lines and headers).
- Preserve the scanned-page order exactly: top-to-bottom, then left-to-right if two entries share a line.
- plate: UK registration when present, formatted with a space (e.g. "AB12 CDE"). Empty string if absent or unreadable.
- name: person's name when present. Empty string if absent.
- phone: UK mobile/landline when present. Normalise to E.164 with +44 (e.g. +447835156367). Accept 07…, 447…, +44…, or spaced forms. Empty string if absent.
- Partial rows are valid: phone-only, name+phone, plate+phone, etc.
- Do not invent data. If unsure, leave the field empty.
- Ignore totals, dates, prices, and mechanic notes unless they clearly include a customer phone or plate.`;

export function visionScanConfigured(): boolean {
  return Boolean(
    process.env.AZURE_OPENAI_ENDPOINT &&
      process.env.AZURE_OPENAI_API_KEY &&
      process.env.AZURE_OPENAI_DEPLOYMENT,
  );
}

function mimeForBuffer(mime: string, filename?: string): string {
  const m = (mime || "").toLowerCase();
  if (m === "image/png" || m === "image/jpeg" || m === "image/jpg") return m === "image/jpg" ? "image/jpeg" : m;
  if (/\.png$/i.test(filename ?? "")) return "image/png";
  return "image/jpeg";
}

/** Call Azure GPT-5.5 vision on a register page image. */
export async function extractRowsFromImage(
  imageBytes: Buffer,
  opts: { mime?: string; filename?: string } = {},
): Promise<{ rows: VisionExtractRow[]; model: string }> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT!.replace(/\/+$/, "");
  const key = process.env.AZURE_OPENAI_API_KEY!;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT!;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? "2024-10-21-preview";

  const mime = mimeForBuffer(opts.mime ?? "", opts.filename);
  const b64 = imageBytes.toString("base64");
  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract all customer rows from this day-book page in exact top-to-bottom page order." },
            { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
          ],
        },
      ],
      max_completion_tokens: 2000,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`vision_${res.status}: ${detail.slice(0, 300)}`);
  }

  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error("vision_empty_response");

  const parsed = JSON.parse(content) as { rows?: unknown };
  const rawRows = Array.isArray(parsed.rows) ? parsed.rows : [];
  const rows = rawRows
    .map(normalizeVisionRow)
    .filter(isPlausibleLead);

  return { rows, model: String(json.model ?? deployment) };
}

function normalizeVisionRow(raw: unknown): VisionExtractRow {
  const row = raw as Record<string, unknown>;
  const name = String(row.name ?? "").trim();
  const plateRaw = String(row.plate ?? "").trim();
  const phoneRaw = String(row.phone ?? "").trim();

  const plateRule = plateRaw ? applyRule("plate", plateRaw) : { value: "", ruleConfidence: 0 };
  const plate = plateRule.value ? formatPlate(plateRule.value.replace(/\s+/g, "")) : "";

  const phone = normalizePhone(phoneRaw) ?? (phoneRaw ? phoneRaw : "");

  const nameRule = name ? applyRule("name", name) : { value: "", ruleConfidence: 0 };

  return {
    name: nameRule.value,
    plate,
    phone,
  };
}

function isPlausibleLead(row: VisionExtractRow): boolean {
  const plateAlnum = row.plate.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const hasPlausiblePlate =
    plateAlnum.length >= 4 &&
    plateAlnum.length <= 9 &&
    /[0-9]/.test(plateAlnum) &&
    /[A-Z]/.test(plateAlnum);

  const phoneDigits = row.phone.replace(/\D/g, "").length;
  const hasPlausiblePhone = phoneDigits >= 10;

  const hasName = row.name.replace(/[^A-Za-z]/g, "").length >= 2;

  return hasPlausiblePhone || (hasPlausiblePlate && hasName) || (hasPlausiblePlate && hasPlausiblePhone);
}

/** Map vision rows into the ScanRow shape the review UI already understands. */
export function visionRowsToScanRows(rows: VisionExtractRow[]): ScanRow[] {
  return rows.map((row, index) => {
    const fields: ReconciledField[] = [];
    const confidence: Record<FieldType, number> = { name: 0, plate: 0, phone: 0 };

    for (const type of ["name", "plate", "phone"] as const) {
      const raw = row[type];
      if (!raw) continue;
      const rule = applyRule(type, raw);
      const conf = Math.round(rule.ruleConfidence * 920) / 1000 + 0.08;
      confidence[type] = conf;
      fields.push({
        type,
        value: type === "plate" ? row.plate : type === "phone" ? row.phone : row.name,
        ocrValue: raw,
        ocrConfidence: 0.92,
        ruleConfidence: rule.ruleConfidence,
        confidence: conf,
        band: bandFor(conf),
        note: rule.note,
      });
    }

    const band = fields.length
      ? fields.map((f) => f.band).includes("red")
        ? "red"
        : fields.map((f) => f.band).includes("amber")
          ? "amber"
          : "green"
      : "amber";

    return {
      id: `v${index + 1}`,
      rowIndex: index,
      name: row.name,
      plate: row.plate,
      phone: row.phone,
      fields,
      confidence,
      band,
    };
  });
}

import { NextRequest, NextResponse } from "next/server";
import { analyzeDocument } from "@/lib/scan/doc-intel";
import { buildRows } from "@/lib/scan/pipeline";
import { extractRowsFromImage, visionRowsToScanRows, visionScanConfigured } from "@/lib/scan/vision";

export const maxDuration = 120;

/**
 * Accepts a photographed register page (multipart form, field "file"),
 * runs GPT-5.5 vision (preferred) or Azure Document Intelligence OCR (fallback),
 * and returns banded rows for review.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }
  if (file.size > 12 * 1024 * 1024) {
    return NextResponse.json({ error: "file_too_large" }, { status: 400 });
  }
  const mime = (file.type || "").toLowerCase();
  const extOk = /\.(png|jpe?g)$/i.test(file.name || "");
  const mimeOk = mime === "image/png" || mime === "image/jpeg" || mime === "image/jpg";
  if (!mimeOk && !extOk) {
    return NextResponse.json({ error: "unsupported_format", hint: "PNG or JPG only" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const engine = (process.env.SCAN_ENGINE ?? "vision").toLowerCase();
  const allowOcrFallback = process.env.SCAN_FALLBACK_OCR !== "false";

  if (engine !== "ocr" && visionScanConfigured()) {
    try {
      const { rows, model } = await extractRowsFromImage(buf, { mime, filename: file.name });
      const scanRows = visionRowsToScanRows(rows);
      return NextResponse.json({
        rows: scanRows,
        engine: "vision",
        model,
        counts: bandCounts(scanRows),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "vision_failed";
      console.error("vision scan failed:", msg);
      if (engine === "vision" && !allowOcrFallback) {
        return NextResponse.json({ error: "vision_failed", detail: msg }, { status: 502 });
      }
      console.warn("falling back to document intelligence OCR");
    }
  }

  if (!visionScanConfigured() && engine === "vision") {
    console.warn("vision not configured — using OCR");
  }

  const base64 = buf.toString("base64");
  try {
    let out = await analyzeDocument(base64, "prebuilt-layout", { highRes: true });
    if (!out.tableRows?.length && !(out.words?.length ?? 0)) {
      out = await analyzeDocument(base64, "prebuilt-read", { highRes: true });
    }
    const rows = await buildRows(out);
    return NextResponse.json({
      rows,
      engine: "ocr",
      model: out.modelId,
      counts: bandCounts(rows),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "scan_failed";
    if (msg === "doc_intel_not_configured") {
      return NextResponse.json({ error: msg }, { status: 503 });
    }
    console.error("scan failed:", msg);
    return NextResponse.json({ error: "scan_failed" }, { status: 502 });
  }
}

function bandCounts(rows: { band: string }[]) {
  return {
    total: rows.length,
    green: rows.filter((r) => r.band === "green").length,
    amber: rows.filter((r) => r.band === "amber").length,
    red: rows.filter((r) => r.band === "red").length,
  };
}

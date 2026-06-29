import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { runOutboundBatch, outboundEngineEnabled } from "@/lib/engine/outbound";

export const maxDuration = 300;

/**
 * Outbound engine tick. Trigger via Vercel cron / n8n schedule:
 *   POST /api/engine/outbound  (header: x-engine-secret)
 *
 * In V3 the n8n worker owns sending, so this legacy native path is disabled by
 * default. It only runs when OUTBOUND_ENGINE_ENABLED=true, which keeps the daily
 * Vercel cron inert (no patient messages) on a fresh deploy.
 */
export async function POST(req: NextRequest) {
  if (!outboundEngineEnabled()) {
    return NextResponse.json({ ok: true, skipped: "engine_disabled" });
  }

  const secret = process.env.ENGINE_SECRET;
  if (secret && req.headers.get("x-engine-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = supabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "no_storage" }, { status: 503 });

  try {
    const results = await runOutboundBatch(supabase);
    return NextResponse.json({
      ok: true,
      totalSent: results.reduce((s, r) => s + r.sent, 0),
      tenants: results,
    });
  } catch (err) {
    console.error("outbound batch failed:", err);
    return NextResponse.json({ error: "batch_failed" }, { status: 500 });
  }
}

/** Vercel cron uses GET. */
export async function GET(req: NextRequest) {
  return POST(req);
}

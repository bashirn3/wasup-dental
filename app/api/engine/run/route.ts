import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveTenantId } from "@/lib/auth";
import { runOutboundForTenant, outboundEngineEnabled } from "@/lib/engine/outbound";

export const maxDuration = 300;

/**
 * Manual "Send outreach now" for the signed-in practice.
 *
 * Unlike the daily cron (/api/engine/outbound), this runs only for the caller's
 * tenant and bypasses the auto-contact switch + sending-hours window so it can
 * be tested on demand. It still respects the daily cap, the due-soon window, and
 * the no-double-text guard (only leads with status = "new" are messaged), so
 * customers who were already contacted are never messaged twice.
 */
export async function POST(req: NextRequest) {
  if (!outboundEngineEnabled()) {
    return NextResponse.json({ ok: true, skipped: "engine_disabled" });
  }

  let clientTenantId: string | null = null;
  try {
    const body = (await req.json()) as { tenantId?: string };
    clientTenantId = body.tenantId ?? null;
  } catch {
    /* body optional */
  }

  const tenantId = await resolveTenantId(clientTenantId);
  if (!tenantId) return NextResponse.json({ error: "missing_tenant" }, { status: 400 });

  const supabase = supabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "no_storage" }, { status: 503 });

  try {
    const result = await runOutboundForTenant(supabase, tenantId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("manual outbound run failed:", err);
    return NextResponse.json({ error: "run_failed" }, { status: 500 });
  }
}

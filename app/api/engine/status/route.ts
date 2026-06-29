import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveTenantId } from "@/lib/auth";
import { isOutreachInProgress } from "@/lib/engine/outbound";

/** Poll whether automatic or manual outreach is actively sending for this practice. */
export async function GET(req: NextRequest) {
  const tenantId = await resolveTenantId(req.nextUrl.searchParams.get("tenantId"));
  if (!tenantId) return NextResponse.json({ error: "missing_tenant" }, { status: 400 });

  const supabase = supabaseAdmin();
  if (!supabase) return NextResponse.json({ inProgress: false });

  const inProgress = await isOutreachInProgress(supabase, tenantId);
  return NextResponse.json({ inProgress });
}

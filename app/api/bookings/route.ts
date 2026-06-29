import { NextRequest, NextResponse } from "next/server";
import { resolveTenantId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const tenantId = await resolveTenantId(req.nextUrl.searchParams.get("tenantId"));
  if (!tenantId) return NextResponse.json({ error: "missing_tenant" }, { status: 400 });

  const supabase = supabaseAdmin();
  if (!supabase) return NextResponse.json({ bookings: [], storage: "none" });

  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");

  let query = supabase
    .from("bookings")
    .select(
      "id, slot_start, slot_end, status, mot_class, created_via, leads(id, first_name, last_name, phone, registration, vehicle)",
    )
    .eq("tenant_id", tenantId)
    .neq("status", "cancelled")
    .order("slot_start", { ascending: true });

  if (from) query = query.gte("slot_start", from);
  if (to) query = query.lt("slot_start", to);

  const { data, error } = await query.limit(500);
  if (error) {
    console.error("bookings list failed:", error);
    return NextResponse.json({ error: "list_failed" }, { status: 500 });
  }

  return NextResponse.json({ bookings: data ?? [] });
}

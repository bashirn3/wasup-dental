import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveTenantId } from "@/lib/auth";

export const DEFAULT_SETTINGS = {
  auto_contact_enabled: false,
  daily_contact_cap: 20,
  due_soon_days: 30,
  sending_hours: { start: "09:00", end: "18:00" },
  include_overdue: true,
};

export async function GET(req: NextRequest) {
  const tenantId = await resolveTenantId(req.nextUrl.searchParams.get("tenantId"));
  if (!tenantId) return NextResponse.json({ error: "missing_tenant" }, { status: 400 });

  const supabase = supabaseAdmin();
  if (!supabase) return NextResponse.json({ settings: DEFAULT_SETTINGS, storage: "none" });

  // select("*") so a not-yet-migrated DB (missing include_overdue) still works.
  const { data } = await supabase
    .from("tenant_settings")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  return NextResponse.json({
    settings: { ...DEFAULT_SETTINGS, ...(data ?? {}) },
  });
}

export async function PUT(req: NextRequest) {
  const { tenantId: clientTenantId, ...updates } = (await req.json()) as {
    tenantId?: string;
    auto_contact_enabled?: boolean;
    daily_contact_cap?: number;
    due_soon_days?: number;
    sending_hours?: { start: string; end: string };
    handoff_email?: string | null;
    include_overdue?: boolean;
  };
  const tenantId = await resolveTenantId(clientTenantId);
  if (!tenantId) return NextResponse.json({ error: "missing_tenant" }, { status: 400 });

  const cap = updates.daily_contact_cap;
  if (cap !== undefined && (cap < 1 || cap > 200)) {
    return NextResponse.json({ error: "cap_out_of_range" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "no_storage" }, { status: 503 });

  const row = { tenant_id: tenantId, ...updates, updated_at: new Date().toISOString() };
  let { error } = await supabase.from("tenant_settings").upsert(row);

  // Backward-compat: if the DB hasn't run migration-004 yet, the include_overdue
  // column won't exist — strip it and retry so the rest of settings still save.
  if (error && /include_overdue/.test(error.message)) {
    const { include_overdue: _omit, ...rest } = row;
    void _omit;
    ({ error } = await supabase.from("tenant_settings").upsert(rest));
  }

  if (error) {
    console.error("settings save failed:", error);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolvePracticeMembership } from "@/lib/dental-auth";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type LegacyLeadRow = {
  boxly_lead_id?: string | null;
  full_name?: string | null;
  phone_e164?: string | null;
  phone_number?: string | null;
  box_name?: string | null;
  box_stage?: string | null;
  lead_source?: string | null;
  ai_actioned?: boolean | null;
  actioned?: boolean | null;
  conversation_count?: number | null;
  last_updated_at?: string | null;
};

type IntegrationRow = {
  id: string;
  display_name: string;
  settings: {
    legacyLeadsTable?: string;
    legacySupabaseUrlEnv?: string;
    legacySupabaseServiceRoleKeyEnv?: string;
  } | null;
};

function clampLimit(value: string | null) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 25;
}

export async function GET(req: NextRequest) {
  const membership = await resolvePracticeMembership(req.nextUrl.searchParams.get("practiceId"));
  if (!membership?.practiceId || membership.role !== "admin") {
    return NextResponse.json({ error: "admin_required" }, { status: 403 });
  }

  const supabase = supabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });

  const { data: integration } = (await supabase
    .from("integrations")
    .select("id, display_name, settings")
    .eq("practice_id", membership.practiceId)
    .eq("source_system", "boxly")
    .maybeSingle()) as { data: IntegrationRow | null };

  const urlEnv = integration?.settings?.legacySupabaseUrlEnv;
  const keyEnv = integration?.settings?.legacySupabaseServiceRoleKeyEnv;
  const table = integration?.settings?.legacyLeadsTable;
  const url = urlEnv ? process.env[urlEnv] : undefined;
  const key = keyEnv ? process.env[keyEnv] : undefined;
  if (!url || !key) {
    return NextResponse.json({
      ok: false,
      mode: "preview",
      error: "legacy_env_missing",
      missing: [urlEnv, keyEnv].filter(Boolean),
    }, { status: 503 });
  }
  if (!table) {
    return NextResponse.json({ error: "legacy_table_missing" }, { status: 503 });
  }

  const limit = clampLimit(req.nextUrl.searchParams.get("limit"));
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data, error, count } = await client
    .from(table)
    .select(
      "boxly_lead_id, full_name, phone_e164, phone_number, box_name, box_stage, lead_source, ai_actioned, actioned, conversation_count, last_updated_at",
      { count: "exact" },
    )
    .order("last_updated_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: "boxly_preview_failed", detail: error.code }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    mode: "preview_read_only",
    practiceId: membership.practiceId,
    source: integration?.display_name ?? "Boxly",
    table,
    totalMatching: count ?? null,
    sample: ((data ?? []) as LegacyLeadRow[]).map((row) => ({
      externalId: row.boxly_lead_id ?? null,
      name: row.full_name ?? "Unknown patient",
      phone: row.phone_e164 ?? row.phone_number ?? null,
      boxName: row.box_name ?? null,
      boxStage: row.box_stage ?? null,
      source: row.lead_source ?? "boxly",
      aiActioned: Boolean(row.ai_actioned || row.actioned),
      conversationCount: row.conversation_count ?? 0,
      lastUpdatedAt: row.last_updated_at ?? null,
    })),
  });
}

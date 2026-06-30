import { NextRequest, NextResponse } from "next/server";
import { resolvePracticeMembership } from "@/lib/dental-auth";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Agent prompt version history.
 *
 * GET  /api/agent-config/versions            -> list versions for the practice
 * POST /api/agent-config/versions { versionId } -> make that version active
 *
 * Every save in /api/agent-config creates a new version row; this endpoint lets
 * the dashboard browse them and roll back to a previous approved version.
 */

type VersionRow = {
  id: string;
  version_number: number;
  is_active: boolean;
  prompt: string;
  first_message: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type SupabaseResult<T> = {
  data: T | null;
  error: { code?: string; message: string } | null;
};

const LIST_COLUMNS =
  "id, version_number, is_active, prompt, first_message, created_by, created_at, updated_at";

function preview(text: string, max = 160): string {
  const clean = (text ?? "").trim().replace(/\s+/g, " ");
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export async function GET(req: NextRequest) {
  const membership = await resolvePracticeMembership(req.nextUrl.searchParams.get("practiceId"));
  if (!membership?.practiceId) {
    return NextResponse.json({ error: "practice_not_found" }, { status: 404 });
  }

  const supabase = supabaseAdmin();
  if (!supabase) return NextResponse.json({ versions: [] });

  const { data } = (await supabase
    .from("agent_control_configs")
    .select(LIST_COLUMNS)
    .eq("practice_id", membership.practiceId)
    .order("version_number", { ascending: false })
    .limit(50)) as SupabaseResult<VersionRow[]>;

  const versions = (data ?? []).map((row) => ({
    id: row.id,
    versionNumber: row.version_number,
    isActive: row.is_active,
    promptPreview: preview(row.prompt),
    firstMessagePreview: preview(row.first_message, 100),
    createdBy: row.created_by ?? "dashboard",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return NextResponse.json({ versions });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    practiceId?: string | null;
    versionId?: string;
  };

  const membership = await resolvePracticeMembership(body.practiceId ?? null);
  if (!membership?.practiceId) {
    return NextResponse.json({ error: "practice_not_found" }, { status: 404 });
  }
  if (!body.versionId) {
    return NextResponse.json({ error: "missing_version_id" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "no_storage" }, { status: 503 });

  // The version must belong to this practice — prevents activating another
  // practice's row by id.
  const { data: target } = (await supabase
    .from("agent_control_configs")
    .select("id, practice_id")
    .eq("id", body.versionId)
    .maybeSingle()) as SupabaseResult<{ id: string; practice_id: string }>;

  if (!target || target.practice_id !== membership.practiceId) {
    return NextResponse.json({ error: "version_not_found" }, { status: 404 });
  }

  // Respect the single-active partial unique index: deactivate, then activate.
  const { error: deactivateError } = await supabase
    .from("agent_control_configs")
    .update({ is_active: false })
    .eq("practice_id", membership.practiceId)
    .eq("is_active", true);

  if (deactivateError) {
    return NextResponse.json({ error: "activate_failed" }, { status: 500 });
  }

  const { error: activateError } = await supabase
    .from("agent_control_configs")
    .update({ is_active: true })
    .eq("id", body.versionId);

  if (activateError) {
    return NextResponse.json({ error: "activate_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, activeVersionId: body.versionId });
}

import { NextRequest, NextResponse } from "next/server";
import { defaultAgentPrompt, defaultFirstMessage } from "@/lib/dental-demo-data";
import { resolvePracticeMembership } from "@/lib/dental-auth";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type ConfigRow = {
  id: string;
  practice_id: string;
  version_number: number;
  is_active: boolean;
  first_message: string;
  prompt: string;
  tone: string;
  treatment_focus: string[];
  safety_rules: string[];
  auto_contact_enabled: boolean;
  launch_state: string;
  updated_at: string;
};

type SupabaseResult<T> = {
  data: T | null;
  error: { code?: string; message: string } | null;
};

function serialize(row: ConfigRow) {
  return {
    id: row.id,
    practiceId: row.practice_id,
    versionNumber: row.version_number,
    isActive: row.is_active,
    firstMessage: row.first_message,
    prompt: row.prompt,
    tone: row.tone,
    treatmentFocus: row.treatment_focus,
    safetyRules: row.safety_rules,
    autoContactEnabled: row.auto_contact_enabled,
    launchState: row.launch_state,
    updatedAt: row.updated_at,
  };
}

export async function GET(req: NextRequest) {
  const membership = await resolvePracticeMembership(req.nextUrl.searchParams.get("practiceId"));
  if (!membership?.practiceId) {
    return NextResponse.json({ error: "practice_not_found" }, { status: 404 });
  }

  const supabase = supabaseAdmin();
  if (!supabase) {
    return NextResponse.json({
      config: {
        id: "local",
        practiceId: membership.practiceId,
        versionNumber: 1,
        isActive: false,
        firstMessage: defaultFirstMessage,
        prompt: defaultAgentPrompt,
        tone: "warm",
        treatmentFocus: ["invisalign"],
        safetyRules: [],
        autoContactEnabled: false,
        launchState: "draft",
        updatedAt: new Date().toISOString(),
      },
    });
  }

  const { data } = (await supabase
    .from("agent_control_configs")
    .select(
      "id, practice_id, version_number, is_active, first_message, prompt, tone, treatment_focus, safety_rules, auto_contact_enabled, launch_state, updated_at",
    )
    .eq("practice_id", membership.practiceId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle()) as SupabaseResult<ConfigRow>;

  return NextResponse.json({ config: data ? serialize(data) : null });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    practiceId?: string | null;
    firstMessage?: string;
    prompt?: string;
    tone?: string;
    treatmentFocus?: string[];
    safetyRules?: string[];
  };
  const membership = await resolvePracticeMembership(body.practiceId ?? null);
  if (!membership?.practiceId || membership.role !== "admin") {
    return NextResponse.json({ error: "admin_required" }, { status: 403 });
  }

  const supabase = supabaseAdmin();
  if (!supabase) {
    return NextResponse.json({
      ok: true,
      storage: "local_preview_only",
      versionNumber: 1,
      launchState: "draft",
    });
  }

  const { data: latest } = (await supabase
    .from("agent_control_configs")
    .select("version_number")
    .eq("practice_id", membership.practiceId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle()) as SupabaseResult<{ version_number: number }>;

  const versionNumber = (latest?.version_number ?? 0) + 1;
  const { data, error } = (await supabase
    .from("agent_control_configs")
    .insert({
      practice_id: membership.practiceId,
      version_number: versionNumber,
      is_active: false,
      first_message: body.firstMessage || defaultFirstMessage,
      prompt: body.prompt || defaultAgentPrompt,
      tone: body.tone || "warm",
      treatment_focus: body.treatmentFocus?.length ? body.treatmentFocus : ["invisalign"],
      safety_rules: body.safetyRules ?? [],
      qualification_rules: {},
      stage_filters: {},
      launch_state: "draft",
      auto_contact_enabled: false,
    })
    .select(
      "id, practice_id, version_number, is_active, first_message, prompt, tone, treatment_focus, safety_rules, auto_contact_enabled, launch_state, updated_at",
    )
    .single()) as SupabaseResult<ConfigRow>;

  if (error) {
    return NextResponse.json({ error: "agent_config_save_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, config: data ? serialize(data) : null });
}

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { parseClientEditable } from "@/lib/agent-editable";

export const dynamic = "force-dynamic";

/**
 * Runtime config read contract for the n8n worker.
 *
 * GET /api/runtime-config?practiceId=<uuid>
 * Auth: Authorization: Bearer ${RUNTIME_CONFIG_API_KEY} (server-to-server only).
 *
 * Returns the PUBLISHED runtime config snapshot for a practice. Until the
 * publish/approve gate ships (Slice G), it falls back to assembling the active
 * agent_control_configs row so the worker always has something to read.
 *
 * No provider secrets are ever returned here.
 */

type SupabaseResult<T> = {
  data: T | null;
  error: { code?: string; message: string } | null;
};

type RuntimeConfigRow = {
  version_number: number;
  config: Record<string, unknown>;
  published_at: string | null;
};

type AgentConfigRow = {
  id: string;
  version_number: number;
  first_message: string;
  prompt: string;
  tone: string;
  treatment_focus: string[];
  safety_rules: string[];
  procedures: unknown;
  appointment_settings: unknown;
  workflow_settings: unknown;
  auto_contact_enabled: boolean;
  launch_state: string;
  updated_at: string;
};

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const expectedKey = process.env.RUNTIME_CONFIG_API_KEY;
  if (!expectedKey) {
    // Never serve runtime config without a configured server key.
    return NextResponse.json({ error: "runtime_config_not_configured" }, { status: 503 });
  }
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!provided || provided !== expectedKey) return unauthorized();

  const practiceId = req.nextUrl.searchParams.get("practiceId");
  if (!practiceId) {
    return NextResponse.json({ error: "missing_practice_id" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "no_storage" }, { status: 503 });

  // 1) Prefer the published snapshot.
  const { data: published } = (await supabase
    .from("runtime_config_versions")
    .select("version_number, config, published_at")
    .eq("practice_id", practiceId)
    .eq("is_published", true)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle()) as SupabaseResult<RuntimeConfigRow>;

  if (published) {
    return NextResponse.json({
      practiceId,
      source: "published_snapshot",
      versionNumber: published.version_number,
      publishedAt: published.published_at,
      config: published.config,
    });
  }

  // 2) Fallback: assemble from the latest active agent config (pre-publish-gate).
  const { data: active } = (await supabase
    .from("agent_control_configs")
    .select(
      "id, version_number, first_message, prompt, tone, treatment_focus, safety_rules, procedures, appointment_settings, workflow_settings, auto_contact_enabled, launch_state, updated_at",
    )
    .eq("practice_id", practiceId)
    .order("is_active", { ascending: false })
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle()) as SupabaseResult<AgentConfigRow>;

  if (!active) {
    return NextResponse.json({ error: "no_config_for_practice" }, { status: 404 });
  }

  return NextResponse.json({
    practiceId,
    source: "active_config_fallback",
    versionNumber: active.version_number,
    publishedAt: null,
    config: {
      firstMessage: active.first_message,
      prompt: active.prompt,
      tone: active.tone,
      treatmentFocus: active.treatment_focus,
      safetyRules: active.safety_rules,
      procedures: active.procedures ?? [],
      appointmentSettings: active.appointment_settings ?? {},
      workflowSettings: active.workflow_settings ?? {},
      // Fully-typed, safe-defaulted client-editable surface (facts, misc,
      // per-treatment openers/templates) for the worker to overlay.
      clientEditable: parseClientEditable(
        (active.workflow_settings as { clientEditable?: unknown } | null)?.clientEditable,
      ),
      autoContactEnabled: active.auto_contact_enabled,
      launchState: active.launch_state,
      updatedAt: active.updated_at,
    },
  });
}

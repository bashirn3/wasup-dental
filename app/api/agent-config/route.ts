import { NextRequest, NextResponse } from "next/server";
import { defaultAgentPrompt, defaultFirstMessage } from "@/lib/dental-demo-data";
import { resolvePracticeMembership } from "@/lib/dental-auth";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Client-editable subset stored inside agent_control_configs.workflow_settings.
 * The n8n worker reads these (via /api/runtime-config) so practice owners like
 * Asif can change persona/hours/knowledge without anyone editing the workflow.
 */
type ClientEditable = {
  assistantName: string;
  openingHours: string;
  closingHours: string;
  knowledge: string;
};

type WorkflowSettings = Record<string, unknown> & {
  clientEditable?: Partial<ClientEditable>;
};

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
  workflow_settings: WorkflowSettings | null;
  appointment_settings: Record<string, unknown> | null;
  auto_contact_enabled: boolean;
  launch_state: string;
  updated_at: string;
};

type SupabaseResult<T> = {
  data: T | null;
  error: { code?: string; message: string } | null;
};

const SELECT_COLUMNS =
  "id, practice_id, version_number, is_active, first_message, prompt, tone, treatment_focus, safety_rules, workflow_settings, appointment_settings, auto_contact_enabled, launch_state, updated_at";

const EMPTY_CLIENT_EDITABLE: ClientEditable = {
  assistantName: "",
  openingHours: "",
  closingHours: "",
  knowledge: "",
};

function clientEditableFrom(workflowSettings: WorkflowSettings | null): ClientEditable {
  const raw = workflowSettings?.clientEditable ?? {};
  return {
    assistantName: typeof raw.assistantName === "string" ? raw.assistantName : "",
    openingHours: typeof raw.openingHours === "string" ? raw.openingHours : "",
    closingHours: typeof raw.closingHours === "string" ? raw.closingHours : "",
    knowledge: typeof raw.knowledge === "string" ? raw.knowledge : "",
  };
}

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
    clientEditable: clientEditableFrom(row.workflow_settings),
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
        clientEditable: EMPTY_CLIENT_EDITABLE,
        autoContactEnabled: false,
        launchState: "draft",
        updatedAt: new Date().toISOString(),
      },
    });
  }

  const { data } = (await supabase
    .from("agent_control_configs")
    .select(SELECT_COLUMNS)
    .eq("practice_id", membership.practiceId)
    .order("is_active", { ascending: false })
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle()) as SupabaseResult<ConfigRow>;

  return NextResponse.json({ config: data ? serialize(data) : null });
}

function cleanString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    practiceId?: string | null;
    firstMessage?: string;
    prompt?: string;
    tone?: string;
    treatmentFocus?: string[];
    safetyRules?: string[];
    assistantName?: string;
    openingHours?: string;
    closingHours?: string;
    knowledge?: string;
  };

  // Any member of the practice (admin or client) may self-edit their own agent.
  // resolvePracticeMembership returns null for practices the caller cannot access,
  // so a client can only ever write to their own practice.
  const membership = await resolvePracticeMembership(body.practiceId ?? null);
  if (!membership?.practiceId) {
    return NextResponse.json({ error: "practice_not_found" }, { status: 404 });
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

  // Carry forward the latest version so a client editing the visible subset
  // never wipes admin-managed fields (treatment focus, safety rules, etc.).
  const { data: latest } = (await supabase
    .from("agent_control_configs")
    .select(SELECT_COLUMNS)
    .eq("practice_id", membership.practiceId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle()) as SupabaseResult<ConfigRow>;

  const versionNumber = (latest?.version_number ?? 0) + 1;
  const previousEditable = clientEditableFrom(latest?.workflow_settings ?? null);
  const nextEditable: ClientEditable = {
    assistantName: cleanString(body.assistantName, previousEditable.assistantName),
    openingHours: cleanString(body.openingHours, previousEditable.openingHours),
    closingHours: cleanString(body.closingHours, previousEditable.closingHours),
    knowledge: cleanString(body.knowledge, previousEditable.knowledge),
  };
  const workflowSettings: WorkflowSettings = {
    ...(latest?.workflow_settings ?? {}),
    clientEditable: nextEditable,
  };

  const { data: inserted, error: insertError } = (await supabase
    .from("agent_control_configs")
    .insert({
      practice_id: membership.practiceId,
      version_number: versionNumber,
      is_active: false,
      first_message: cleanString(body.firstMessage, latest?.first_message ?? defaultFirstMessage),
      prompt: cleanString(body.prompt, latest?.prompt ?? defaultAgentPrompt),
      tone: cleanString(body.tone, latest?.tone ?? "warm"),
      treatment_focus: body.treatmentFocus?.length
        ? body.treatmentFocus
        : latest?.treatment_focus?.length
          ? latest.treatment_focus
          : ["invisalign"],
      safety_rules: body.safetyRules ?? latest?.safety_rules ?? [],
      qualification_rules: {},
      stage_filters: {},
      workflow_settings: workflowSettings,
      appointment_settings: latest?.appointment_settings ?? {},
      launch_state: latest?.launch_state ?? "draft",
      auto_contact_enabled: latest?.auto_contact_enabled ?? false,
      created_by: membership.email ?? "dashboard",
    })
    .select(SELECT_COLUMNS)
    .single()) as SupabaseResult<ConfigRow>;

  if (insertError || !inserted) {
    return NextResponse.json({ error: "agent_config_save_failed" }, { status: 500 });
  }

  // Flip the active pointer so /api/runtime-config (and the worker) serve this edit.
  const { error: deactivateError } = await supabase
    .from("agent_control_configs")
    .update({ is_active: false })
    .eq("practice_id", membership.practiceId)
    .eq("is_active", true);

  if (deactivateError) {
    return NextResponse.json({ error: "agent_config_activate_failed" }, { status: 500 });
  }

  const { data: activated, error: activateError } = (await supabase
    .from("agent_control_configs")
    .update({ is_active: true })
    .eq("id", inserted.id)
    .select(SELECT_COLUMNS)
    .single()) as SupabaseResult<ConfigRow>;

  if (activateError) {
    return NextResponse.json({ error: "agent_config_activate_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, config: serialize(activated ?? inserted) });
}

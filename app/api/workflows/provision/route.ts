import { NextRequest, NextResponse } from "next/server";
import { resolvePracticeMembership } from "@/lib/dental-auth";
import { supabaseAdmin } from "@/lib/supabase";
import {
  dentalWorkflowTemplates,
  workflowProvisioningConfig,
} from "@/lib/workflow-provisioning";

export const dynamic = "force-dynamic";

type SupabaseResult<T> = {
  data: T | null;
  error: { code?: string; message: string } | null;
};

type PracticeRow = {
  id: string;
  wasup_instance_id: string | null;
  connected_number: string | null;
};

type WorkflowRow = {
  id: string;
  workflow_type: string;
  template_key: string;
  display_name: string;
  mode: string;
  status: string;
  active: boolean;
  launch_ready: boolean;
  webhook_path: string | null;
};

function serialize(row: WorkflowRow) {
  return {
    id: row.id,
    workflowType: row.workflow_type,
    templateKey: row.template_key,
    displayName: row.display_name,
    mode: row.mode,
    status: row.status,
    active: row.active,
    launchReady: row.launch_ready,
    webhookPath: row.webhook_path,
  };
}

export async function GET(req: NextRequest) {
  const membership = await resolvePracticeMembership(req.nextUrl.searchParams.get("practiceId"));
  if (!membership?.practiceId) {
    return NextResponse.json({ error: "practice_not_found" }, { status: 404 });
  }

  const supabase = supabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ ok: true, practiceId: membership.practiceId, workflows: [] });
  }

  const { data, error } = (await supabase
    .from("workflow_provisionings")
    .select("id, workflow_type, template_key, display_name, mode, status, active, launch_ready, webhook_path")
    .eq("practice_id", membership.practiceId)
    .order("created_at", { ascending: true })) as SupabaseResult<WorkflowRow[]>;

  if (error) {
    return NextResponse.json({ error: "workflow_read_failed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    practiceId: membership.practiceId,
    workflows: (data ?? []).map(serialize),
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { practiceId?: string | null };
  const membership = await resolvePracticeMembership(body.practiceId ?? null);
  if (!membership?.practiceId || membership.role !== "admin") {
    return NextResponse.json({ error: "admin_required" }, { status: 403 });
  }

  const supabase = supabaseAdmin();
  if (!supabase) {
    return NextResponse.json({
      ok: true,
      practiceId: membership.practiceId,
      mode: "local_preview_only",
      active: false,
      workflows: dentalWorkflowTemplates.map((template) => ({
        id: `preview-${template.workflowType}`,
        workflowType: template.workflowType,
        templateKey: template.templateKey,
        displayName: template.displayName,
        mode: "dry_run",
        status: "draft",
        active: false,
        launchReady: false,
        webhookPath: template.webhookPath,
      })),
    });
  }

  const { data: practice } = (await supabase
    .from("practices")
    .select("id, wasup_instance_id, connected_number")
    .eq("id", membership.practiceId)
    .maybeSingle()) as SupabaseResult<PracticeRow>;

  if (!practice) {
    return NextResponse.json({ error: "practice_not_found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const rows = dentalWorkflowTemplates.map((template) => ({
    practice_id: practice.id,
    workflow_type: template.workflowType,
    template_key: template.templateKey,
    display_name: template.displayName,
    mode: "dry_run",
    status: "draft",
    active: false,
    launch_ready: false,
    provider_instance_id: practice.wasup_instance_id,
    provider_number: practice.connected_number,
    webhook_path: template.webhookPath,
    config: {
      ...workflowProvisioningConfig(practice.id),
      template,
      sideEffectsDisabled: template.sideEffects,
      provisionedAt: now,
    },
    updated_at: now,
  }));

  const { data, error } = (await supabase
    .from("workflow_provisionings")
    .upsert(rows, { onConflict: "practice_id,workflow_type" })
    .select("id, workflow_type, template_key, display_name, mode, status, active, launch_ready, webhook_path")
    .order("created_at", { ascending: true })) as SupabaseResult<WorkflowRow[]>;

  if (error) {
    return NextResponse.json(
      { error: "workflow_provisioning_failed", detail: { code: error.code } },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    practiceId: practice.id,
    mode: "inactive_dry_run_records_only",
    active: false,
    workflows: (data ?? []).map(serialize),
  });
}

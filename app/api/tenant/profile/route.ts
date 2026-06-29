import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveTenantId } from "@/lib/auth";
import { tenantToDraft } from "@/lib/engine/prompt";
import type { TenantRow } from "@/lib/engine/prompt";

function extractAgentName(systemPrompt: string): string {
  const match = systemPrompt.match(/^You are (.*?), the WhatsApp assistant/m);
  return match?.[1]?.trim() || "Assistant";
}

function extractCustomInstructions(systemPrompt: string): string {
  const marker = "\n## Owner's instructions\n";
  const index = systemPrompt.indexOf(marker);
  return index >= 0 ? systemPrompt.slice(index + marker.length).trim() : "";
}

/** Full garage profile + active agent config for the settings editor. */
export async function GET(req: NextRequest) {
  const tenantId = await resolveTenantId(req.nextUrl.searchParams.get("tenantId"));
  if (!tenantId) return NextResponse.json({ error: "missing_tenant" }, { status: 400 });

  const supabase = supabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "no_storage" }, { status: 503 });

  const { data: tenant, error } = await supabase
    .from("tenants")
    .select(
      "id, name, address, phone, website, opening_hours, mot_classes, prices, free_retest, tone, wasup_instance_id",
    )
    .eq("id", tenantId)
    .maybeSingle();

  if (error || !tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }

  const { data: activeConfig } = await supabase
    .from("agent_configs")
    .select("id, version, system_prompt, first_message_prompt, tone, is_active, created_at")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const draft = tenantToDraft(tenant as TenantRow);

  return NextResponse.json({
    draft,
    config: activeConfig
      ? {
          agentName: extractAgentName(activeConfig.system_prompt ?? ""),
          tone: activeConfig.tone,
          customInstructions: extractCustomInstructions(activeConfig.system_prompt ?? ""),
          firstMessage: activeConfig.first_message_prompt ?? "",
          version: activeConfig.version,
          versionId: activeConfig.id,
        }
      : null,
  });
}

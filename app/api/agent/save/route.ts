import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveTenantId } from "@/lib/auth";

function extractAgentName(systemPrompt: string): string {
  const match = systemPrompt.match(/^You are (.*?), the WhatsApp assistant/m);
  return match?.[1]?.trim() || "Assistant";
}

function extractCustomInstructions(systemPrompt: string): string {
  const marker = "\n## Owner's instructions\n";
  const index = systemPrompt.indexOf(marker);
  return index >= 0 ? systemPrompt.slice(index + marker.length).trim() : "";
}

export async function GET(req: NextRequest) {
  const tenantId = await resolveTenantId(req.nextUrl.searchParams.get("tenantId"));
  if (!tenantId) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  if (!supabase) return NextResponse.json({ versions: [] });

  const { data, error } = await supabase
    .from("agent_configs")
    .select("id, version, system_prompt, first_message_prompt, tone, is_active, created_at")
    .eq("tenant_id", tenantId)
    .order("version", { ascending: false })
    .limit(12);

  if (error) {
    console.error("agent config history failed:", error);
    return NextResponse.json({ error: "history_failed" }, { status: 500 });
  }

  return NextResponse.json({
    versions: (data ?? []).map((item) => ({
      id: item.id,
      version: item.version,
      agentName: extractAgentName(item.system_prompt ?? ""),
      customInstructions: extractCustomInstructions(item.system_prompt ?? ""),
      firstMessage: item.first_message_prompt ?? "",
      tone: item.tone,
      isActive: item.is_active,
      createdAt: item.created_at,
    })),
  });
}

/** Persist the agent config so the engine uses exactly what was tested. */
export async function POST(req: NextRequest) {
  const { tenantId: clientTenantId, agentName, tone, firstMessage, systemPrompt } = (await req.json()) as {
    tenantId?: string;
    agentName?: string;
    tone?: string;
    firstMessage?: string;
    systemPrompt?: string;
  };

  const tenantId = await resolveTenantId(clientTenantId);
  if (!tenantId || !systemPrompt) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  if (!supabase) return NextResponse.json({ ok: true, storage: "local" });

  const { data: latest } = await supabase
    .from("agent_configs")
    .select("version")
    .eq("tenant_id", tenantId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle<{ version: number }>();

  const nextVersion = (latest?.version ?? 0) + 1;

  await supabase
    .from("agent_configs")
    .update({ is_active: false })
    .eq("tenant_id", tenantId)
    .eq("is_active", true);

  const { data, error } = await supabase
    .from("agent_configs")
    .insert({
      tenant_id: tenantId,
      version: nextVersion,
      system_prompt: systemPrompt,
      first_message_prompt: firstMessage ?? "",
      tone: tone ?? "friendly",
      is_active: true,
    })
    .select("id, version, created_at")
    .single();

  if (error) {
    console.error("agent config save failed:", error);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  await supabase
    .from("tenants")
    .update({ tone: tone ?? "friendly", onboarding_status: "agent_ready" })
    .eq("id", tenantId);

  return NextResponse.json({
    ok: true,
    storage: "supabase",
    agentName,
    version: data?.version ?? nextVersion,
    versionId: data?.id,
    createdAt: data?.created_at,
  });
}

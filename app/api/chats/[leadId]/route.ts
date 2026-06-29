import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveTenantId } from "@/lib/auth";
import { sendMessage } from "@/lib/engine/wasup";

/** Full thread for one lead. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const { leadId } = await params;
  const tenantId = await resolveTenantId(req.nextUrl.searchParams.get("tenantId"));
  if (!tenantId) return NextResponse.json({ error: "missing_tenant" }, { status: 400 });

  const supabase = supabaseAdmin();
  if (!supabase) return NextResponse.json({ messages: [] });

  const { data } = await supabase
    .from("messages")
    .select("id, direction, body, delivery_status, created_at")
    .eq("tenant_id", tenantId)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true })
    .limit(200);

  return NextResponse.json({ messages: data ?? [] });
}

/** Manual (human takeover) message into the thread. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const { leadId } = await params;
  const { tenantId: clientTenantId, body } = (await req.json()) as {
    tenantId?: string;
    body?: string;
  };
  const tenantId = await resolveTenantId(clientTenantId);
  if (!tenantId || !body?.trim()) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "no_storage" }, { status: 503 });

  const [{ data: lead }, { data: tenant }] = await Promise.all([
    supabase.from("leads").select("phone").eq("id", leadId).eq("tenant_id", tenantId).single(),
    supabase.from("tenants").select("wasup_instance_id").eq("id", tenantId).single(),
  ]);
  if (!lead || !tenant?.wasup_instance_id) {
    return NextResponse.json({ error: "not_connected" }, { status: 400 });
  }

  const outcome = await sendMessage(tenant.wasup_instance_id, lead.phone, body.trim());
  await supabase.from("messages").insert({
    tenant_id: tenantId,
    lead_id: leadId,
    direction: "outbound",
    body: body.trim(),
    wa_message_id: outcome.messageId,
    delivery_status: outcome.ok ? "sent" : "failed",
  });

  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.blockedReason ?? "send_failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}

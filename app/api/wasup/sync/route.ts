import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveTenantId } from "@/lib/auth";
import { linkWasupInstance } from "@/lib/wa-tenant";

/** Attach a Wasup instance id to the signed-in tenant when setup saved it locally only. */
export async function POST(req: NextRequest) {
  const { tenantId: clientTenantId, instanceId } = (await req.json()) as {
    tenantId?: string;
    instanceId?: string;
  };

  const tenantId = await resolveTenantId(clientTenantId);
  if (!tenantId) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }
  if (!instanceId?.trim()) {
    return NextResponse.json({ error: "missing_instance" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }

  const { data: tenant } = await supabase
    .from("tenants")
    .select("wasup_instance_id")
    .eq("id", tenantId)
    .maybeSingle();

  if (tenant?.wasup_instance_id) {
    return NextResponse.json({ ok: true, instanceId: tenant.wasup_instance_id, reused: true });
  }

  const { data: owner } = await supabase
    .from("tenants")
    .select("id")
    .eq("wasup_instance_id", instanceId)
    .maybeSingle();

  if (owner && owner.id !== tenantId) {
    return NextResponse.json({ error: "instance_owned_elsewhere" }, { status: 409 });
  }

  await linkWasupInstance(supabase, tenantId, instanceId, {
    onboardingStatus: "whatsapp_connecting",
  });

  return NextResponse.json({ ok: true, instanceId, synced: true });
}

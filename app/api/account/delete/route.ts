import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import { clerkEnabled, currentUserId, resolveTenantId } from "@/lib/auth";
import { deleteWasupInstance } from "@/lib/wasup-instances";

function namesMatch(typed: string, expected: string): boolean {
  return typed.trim().toLowerCase() === expected.trim().toLowerCase();
}

export async function POST(req: NextRequest) {
  const { tenantId: clientTenantId, confirmName } = (await req.json()) as {
    tenantId?: string;
    confirmName?: string;
  };

  const userId = await currentUserId();
  if (clerkEnabled() && !userId) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }

  const tenantId = await resolveTenantId(clientTenantId);
  if (!tenantId) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }

  if (!confirmName?.trim()) {
    return NextResponse.json({ error: "confirm_required" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }

  const { data: tenant, error: fetchError } = await supabase
    .from("tenants")
    .select("id, name, clerk_org_id, clerk_owner_user_id, wasup_instance_id, wasup_api_key")
    .eq("id", tenantId)
    .maybeSingle();

  if (fetchError || !tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }

  const ownerMatches =
    tenant.clerk_owner_user_id === userId ||
    (!tenant.clerk_owner_user_id && tenant.clerk_org_id === userId);
  if (userId && !ownerMatches) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (!namesMatch(confirmName, tenant.name)) {
    return NextResponse.json({ error: "confirm_mismatch" }, { status: 400 });
  }

  if (tenant.wasup_instance_id) {
    const deleted = await deleteWasupInstance(tenant.wasup_instance_id, tenant.wasup_api_key);
    if (!deleted.ok) {
      console.warn("wasup instance delete on account delete failed:", deleted.status);
    }
  }

  const { error: deleteError } = await supabase.from("tenants").delete().eq("id", tenantId);
  if (deleteError) {
    console.error("tenant delete failed:", deleteError);
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }

  if (userId && clerkEnabled()) {
    try {
      const client = await clerkClient();
      await client.users.deleteUser(userId);
    } catch (err) {
      console.error("clerk user delete failed:", err);
      return NextResponse.json({ error: "clerk_delete_failed" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}

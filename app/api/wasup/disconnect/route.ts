import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveTenantId } from "@/lib/auth";
import {
  deleteWasupInstance,
  disconnectWasupSession,
  wasupInstancesConfigured,
} from "@/lib/wasup-instances";

export async function POST(req: NextRequest) {
  const { tenantId: clientTenantId, changeNumber, localOnly } = (await req.json()) as {
    tenantId?: string;
    changeNumber?: boolean;
    /** Skip Wasup API — clear tenant link fields only (already disconnected). */
    localOnly?: boolean;
  };

  const tenantId = await resolveTenantId(clientTenantId);
  if (!tenantId) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }

  const supabase = supabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }

  const { data: tenant } = await supabase
    .from("tenants")
    .select("wasup_instance_id, wasup_api_key")
    .eq("id", tenantId)
    .maybeSingle();

  const instanceId = tenant?.wasup_instance_id;
  const instanceApiKey = tenant?.wasup_api_key ?? null;

  if (localOnly && changeNumber) {
    const { error } = await supabase
      .from("tenants")
      .update({
        wasup_instance_id: null,
        wasup_phone: null,
        wasup_api_key: null,
        onboarding_status: "agent_ready",
      })
      .eq("id", tenantId);
    if (error) {
      return NextResponse.json({ error: "disconnect_failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, changeNumber: true, wasupCleared: true, localOnly: true });
  }

  if (!instanceId) {
    return NextResponse.json({ ok: true, changeNumber: Boolean(changeNumber), wasupCleared: true });
  }

  if (!wasupInstancesConfigured()) {
    return NextResponse.json({ error: "wasup_not_configured" }, { status: 503 });
  }

  const wasupResult = changeNumber
    ? await deleteWasupInstance(instanceId, instanceApiKey)
    : await disconnectWasupSession(instanceId, instanceApiKey);

  if (!wasupResult.ok) {
    console.error("wasup disconnect failed:", wasupResult.status, wasupResult.detail, wasupResult.steps);
    // Allow change-number to proceed locally when Wasup instance API is down.
    if (
      changeNumber &&
      (wasupResult.status >= 500 || wasupResult.status === 502 || wasupResult.status === 503)
    ) {
      const { error } = await supabase
        .from("tenants")
        .update({
          wasup_instance_id: null,
          wasup_phone: null,
          wasup_api_key: null,
          onboarding_status: "agent_ready",
        })
        .eq("id", tenantId);
      if (error) {
        return NextResponse.json({ error: "disconnect_failed" }, { status: 500 });
      }
      return NextResponse.json({
        ok: true,
        changeNumber: true,
        wasupCleared: true,
        localFallback: true,
        steps: wasupResult.steps,
      });
    }
    return NextResponse.json(
      {
        error: changeNumber ? "wasup_delete_failed" : "wasup_clear_failed",
        wasupStatus: wasupResult.status,
        detail: wasupResult.detail,
        steps: wasupResult.steps,
      },
      { status: 502 },
    );
  }

  const patch = changeNumber
    ? {
        wasup_instance_id: null,
        wasup_phone: null,
        wasup_api_key: null,
        onboarding_status: "agent_ready",
      }
    : {
        wasup_phone: null,
        onboarding_status: "agent_ready",
      };

  const { error } = await supabase.from("tenants").update(patch).eq("id", tenantId);
  if (error) {
    console.error("wasup disconnect tenant update failed:", error);
    return NextResponse.json({ error: "disconnect_failed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    changeNumber: Boolean(changeNumber),
    wasupCleared: true,
    steps: wasupResult.steps,
  });
}

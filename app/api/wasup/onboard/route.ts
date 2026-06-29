import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveTenantId } from "@/lib/auth";
import {
  clearWasupInstanceLink,
  findConflictingWasupPhone,
  isValidWasupPhone,
  linkWasupInstance,
  normalizeWasupPhone,
} from "@/lib/wa-tenant";
import {
  checkWasupInstance,
  fetchWasupLinkCode,
  fetchWasupQrImage,
  pairingCodeFromPayload,
  wasupInstancesConfigured,
  type WasupLinkMode,
} from "@/lib/wasup-instances";

export const maxDuration = 30;

const BASE = process.env.WASUP_BASE_URL;
const KEY = process.env.WASUP_DEPLOYMENT_API_KEY;
const ONBOARD_TIMEOUT_MS = 25_000;

function wasupPhone(value: string): string {
  return normalizeWasupPhone(value);
}

export async function POST(req: NextRequest) {
  const { phone, name, tenantId: clientTenantId, mode = "qr" } = (await req.json()) as {
    phone?: string;
    name?: string;
    tenantId?: string;
    mode?: WasupLinkMode;
  };
  const tenantId = await resolveTenantId(clientTenantId);
  const linkMode: WasupLinkMode = mode === "code" ? "code" : "qr";

  if (!phone || !isValidWasupPhone(phone)) {
    return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
  }
  if (!wasupInstancesConfigured()) {
    return NextResponse.json({ error: "wasup_not_configured" }, { status: 503 });
  }

  const supabase = supabaseAdmin();
  const phoneDigits = wasupPhone(phone);

  if (tenantId && supabase) {
    const { data: tenant } = await supabase
      .from("tenants")
      .select("wasup_instance_id, wasup_phone, wasup_api_key")
      .eq("id", tenantId)
      .maybeSingle();

    if (tenant?.wasup_instance_id) {
      const live = await checkWasupInstance(tenant.wasup_instance_id, tenant.wasup_api_key ?? null);
      if (live === "missing") {
        await clearWasupInstanceLink(supabase, tenantId);
      } else if (live === "live") {
        // Wasup pairing modes are mutually exclusive — mint only what the client asked for.
        if (linkMode === "code") {
          const pairingCode = await fetchWasupLinkCode(tenant.wasup_instance_id, {
            phone,
            instanceApiKey: tenant.wasup_api_key ?? null,
          });
          return NextResponse.json({
            instanceId: tenant.wasup_instance_id,
            qrCode: null,
            pairingCode,
            status: "connecting",
            phone: tenant.wasup_phone ?? null,
            mode: linkMode,
            reused: true,
          });
        }

        const qrCode = await fetchWasupQrImage(tenant.wasup_instance_id, {
          instanceApiKey: tenant.wasup_api_key ?? null,
        });
        return NextResponse.json({
          instanceId: tenant.wasup_instance_id,
          qrCode,
          pairingCode: null,
          status: "connecting",
          phone: tenant.wasup_phone ?? null,
          mode: linkMode,
          reused: true,
        });
      } else {
        return NextResponse.json(
          { error: "wasup_unavailable", wasupHttpStatus: 502 },
          { status: 503 },
        );
      }
    }

    const conflict = await findConflictingWasupPhone(supabase, phoneDigits, tenantId);
    if (conflict) {
      return NextResponse.json({ error: "phone_already_linked" }, { status: 409 });
    }
  }

  const appBaseUrl = (process.env.APP_BASE_URL || req.nextUrl.origin).replace(/\/+$/, "");

  let res: Response;
  try {
    res = await fetch(`${BASE}/api/onboard`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": KEY!,
      },
      body: JSON.stringify({
        phone: wasupPhone(phone),
        name: name ?? "RapidMOT garage",
        profileName: name,
        // Inbound messages flow straight into the engine.
        webhookUrl: `${appBaseUrl}/api/webhooks/wasup`,
      }),
      signal: AbortSignal.timeout(ONBOARD_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    console.error("wasup onboard request failed:", error);
    return NextResponse.json(
      { error: "wasup_unavailable", wasupHttpStatus: timedOut ? 504 : 502 },
      { status: 503 },
    );
  }

  if (!res.ok) {
    const detail = await res.text();
    console.error("wasup onboard failed:", res.status, detail);
    if (res.status >= 500) {
      return NextResponse.json(
        { error: "wasup_unavailable", wasupHttpStatus: res.status },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "onboard_failed" }, { status: 502 });
  }

  const data = await res.json();
  const instanceApiKey =
    (typeof data.apiKey === "string" && data.apiKey) ||
    (typeof data.api_key === "string" && data.api_key) ||
    (typeof data.instanceApiKey === "string" && data.instanceApiKey) ||
    null;

  // Persist the instance on the tenant when we know who they are.
  if (tenantId && data.instanceId && supabase) {
    await linkWasupInstance(supabase, tenantId, data.instanceId, {
      phone: phoneDigits,
      onboardingStatus: "whatsapp_connecting",
      wasupApiKey: instanceApiKey,
    });
  }

  const onboardCode = linkMode === "code" ? pairingCodeFromPayload(data) : null;

  const sessionCode =
    linkMode === "code" && data.instanceId && !onboardCode
      ? await fetchWasupLinkCode(data.instanceId, {
          phone,
          instanceApiKey,
        })
      : null;

  const qrCode =
    linkMode === "qr" && data.instanceId
      ? await fetchWasupQrImage(data.instanceId, { instanceApiKey })
      : null;

  return NextResponse.json({
    instanceId: data.instanceId,
    qrCode,
    pairingCode: onboardCode ?? sessionCode,
    status: data.status ?? "connecting",
    phone: data.phone ?? null,
    mode: linkMode,
    message: data.message,
  });
}

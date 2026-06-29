import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
import { supabaseAdmin } from "@/lib/supabase";
import { resolveTenantId } from "@/lib/auth";
import { isWasupUnavailableStatus, markWasupConnected, normalizeWasupPhone, clearWasupInstanceLink } from "@/lib/wa-tenant";
import { fetchWasupHealth } from "@/lib/wasup-health";
import {
  fetchWasupPairingPayload,
  fetchWasupQrImage,
  readWasupPairingSnapshot,
  wasupConnectionStatus,
  wasupInstancesConfigured,
  type WasupLinkMode,
} from "@/lib/wasup-instances";

function wasupPhone(value: string): string {
  return normalizeWasupPhone(value);
}

export async function GET(req: NextRequest) {
  const instanceId = req.nextUrl.searchParams.get("instanceId");
  const tenantId = await resolveTenantId(req.nextUrl.searchParams.get("tenantId"));
  const mode: WasupLinkMode = req.nextUrl.searchParams.get("mode") === "code" ? "code" : "qr";
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  const qrOnly = req.nextUrl.searchParams.get("qrOnly") === "1";
  const phoneParam = req.nextUrl.searchParams.get("phone") ?? "";

  if (!instanceId) {
    return NextResponse.json({ error: "missing_instance" }, { status: 400 });
  }
  if (!wasupInstancesConfigured()) {
    return NextResponse.json({ error: "wasup_not_configured" }, { status: 503 });
  }

  let instanceApiKey: string | null = null;
  let tenantWasupPhone: string | null = null;
  if (tenantId) {
    const supabase = supabaseAdmin();
    if (supabase) {
      const { data: tenant } = await supabase
        .from("tenants")
        .select("wasup_phone, wasup_api_key")
        .eq("id", tenantId)
        .maybeSingle();
      tenantWasupPhone = tenant?.wasup_phone ?? null;
      instanceApiKey = tenant?.wasup_api_key ?? null;
    }
  }

  const pairingPhone = phoneParam ? wasupPhone(phoneParam) : tenantWasupPhone;
  const conn = await wasupConnectionStatus(instanceId, instanceApiKey);

  if (conn.missing) {
    if (tenantId) {
      const supabase = supabaseAdmin();
      if (supabase) await clearWasupInstanceLink(supabase, tenantId);
    }
    return NextResponse.json(
      {
        error: "instance_not_found",
        status: "disconnected",
        qrCode: null,
        pairingCode: null,
      },
      { status: 404 },
    );
  }

  if (!conn.ok) {
    const health = await fetchWasupHealth();
    const allowHealthFallback = Boolean(tenantWasupPhone) && health?.ok && health.connected > 0;
    if (allowHealthFallback) {
      const linkedPhone = pairingPhone || tenantWasupPhone;
      if (tenantId) {
        const supabase = supabaseAdmin();
        if (supabase) {
          await markWasupConnected(supabase, tenantId, instanceId, linkedPhone);
        }
      }
      return NextResponse.json({
        status: "connected",
        phone: linkedPhone,
        qrCode: null,
        pairingCode: null,
        healthFallback: true,
      });
    }
  }

  let status = conn.ok ? conn.status : "disconnected";
  let linkedPhone = conn.ok ? conn.phone : tenantWasupPhone;
  let qrCode: string | null = null;
  let pairingCode: string | null = null;

  if (status === "connected") {
    if (tenantId) {
      const supabase = supabaseAdmin();
      if (supabase) {
        await markWasupConnected(supabase, tenantId, instanceId, linkedPhone ?? null);
      }
    }
    return NextResponse.json({
      status,
      phone: linkedPhone ?? null,
      qrCode: null,
      pairingCode: null,
    });
  }

  if (qrOnly) {
    const snapshot = await readWasupPairingSnapshot(instanceId, instanceApiKey, { waitForQr: true });
    const qrCode = snapshot.qrCode ?? (await fetchWasupQrImage(instanceId, { instanceApiKey }));
    return NextResponse.json({
      status: snapshot.status ?? status,
      phone: snapshot.phone ?? linkedPhone ?? null,
      qrCode,
      pairingCode: null,
    });
  }

  const needsPairingMaterial = refresh || status === "connecting" || status === "disconnected";
  if (needsPairingMaterial) {
    if (mode === "code" && !pairingPhone && refresh) {
      return NextResponse.json(
        { error: "phone_required", status: "disconnected", qrCode: null, pairingCode: null },
        { status: 400 },
      );
    }

    if (refresh) {
      const payload = await fetchWasupPairingPayload(instanceId, {
        mode,
        phone: pairingPhone ?? undefined,
        instanceApiKey,
        restartSession: true,
      });
      qrCode = payload.qrCode;
      pairingCode = payload.pairingCode;
      status = payload.status ?? status;
      linkedPhone = payload.phone ?? linkedPhone;
    } else {
      const payload = await readWasupPairingSnapshot(instanceId, instanceApiKey);
      qrCode = payload.qrCode;
      pairingCode = payload.pairingCode;
      status = payload.status ?? status;
      linkedPhone = payload.phone ?? linkedPhone;
    }
  }

  if (!conn.ok && !qrCode && !pairingCode) {
    const health = await fetchWasupHealth();
    const unavailable = isWasupUnavailableStatus(conn.httpStatus) || !health?.ok;
    if (unavailable) {
      return NextResponse.json(
        {
          error: "wasup_unavailable",
          status: "disconnected",
          qrCode: null,
          pairingCode: null,
          wasupHttpStatus: conn.httpStatus,
          wasupConnected: health?.connected ?? 0,
          wasupTotal: health?.total ?? 0,
        },
        { status: 503 },
      );
    }
  }

  return NextResponse.json({
    status,
    phone: linkedPhone ?? null,
    qrCode,
    pairingCode,
  });
}


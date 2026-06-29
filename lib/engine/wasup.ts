const BASE = process.env.WASUP_BASE_URL;
const KEY = process.env.WASUP_DEPLOYMENT_API_KEY;

function configured(): void {
  if (!BASE || !KEY) throw new Error("wasup_not_configured");
}

/** Phone for Wasup: country code, digits only, no plus. */
export function wasupPhone(e164: string): string {
  return e164.replace(/[^\d]/g, "");
}

export type SendOutcome = {
  ok: boolean;
  messageId: string | null;
  blockedReason?: string;
};

/** Send a plain text WhatsApp message from a tenant's instance. */
export async function sendMessage(
  instanceId: string,
  toE164: string,
  message: string,
): Promise<SendOutcome> {
  configured();
  const res = await fetch(
    `${BASE}/api/instances/${encodeURIComponent(instanceId)}/send`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": KEY! },
      body: JSON.stringify({ to: wasupPhone(toE164), message }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      messageId: null,
      blockedReason: data?.error ?? data?.reason ?? `http_${res.status}`,
    };
  }
  return {
    ok: true,
    messageId:
      data?.result?.messageId ??
      data?.result?.id ??
      data?.result?.key?.id ??
      null,
  };
}

/** Tag a chat for human handoff so the agent stays quiet and staff get pinged. */
export async function tagHandoff(instanceId: string, phoneE164: string): Promise<boolean> {
  configured();
  const res = await fetch(
    `${BASE}/api/instances/${encodeURIComponent(instanceId)}/handoff`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": KEY! },
      body: JSON.stringify({ phone: wasupPhone(phoneE164), tagged: true }),
    },
  );
  return res.ok;
}

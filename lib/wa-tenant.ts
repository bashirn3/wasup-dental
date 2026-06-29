import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhone } from "@/lib/csv";

/** Wasup expects country code + digits, no plus (e.g. 447835156367). */
export function normalizeWasupPhone(value: string): string {
  const e164 = normalizePhone(value);
  if (e164) return e164.slice(1);
  let d = (value || "").replace(/[^\d+]/g, "");
  if (!d) return "";
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  return d;
}

/** Accept +44…, 07…, 7…, landline 01…/02…, and other international formats. */
export function isValidWasupPhone(value: string): boolean {
  const d = normalizeWasupPhone(value);
  if (!d) return false;
  if (/^44\d{9,11}$/.test(d)) return true;
  return /^\d{10,15}$/.test(d);
}

export type WaTenantFields = {
  wasup_instance_id?: string | null;
  wasup_phone?: string | null;
};

/** Drop wasup_phone when there is no linked instance (invalid state). */
export function sanitizeWaTenant<T extends WaTenantFields>(tenant: T): T {
  if (!tenant.wasup_instance_id && tenant.wasup_phone) {
    return { ...tenant, wasup_phone: null };
  }
  return tenant;
}

export function isWasupUnavailableStatus(status: number): boolean {
  return status === 500 || status === 502 || status === 503 || status === 504;
}

/** Clear wasup_phone rows that have no instance id. Returns true if a repair ran. */
export async function repairOrphanWasupPhone(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("tenants")
    .select("wasup_instance_id, wasup_phone")
    .eq("id", tenantId)
    .maybeSingle();

  if (!data || data.wasup_instance_id || !data.wasup_phone) return false;

  await supabase.from("tenants").update({ wasup_phone: null }).eq("id", tenantId);
  return true;
}

/** Another tenant already owns this WhatsApp number with a live instance. */
export async function findConflictingWasupPhone(
  supabase: SupabaseClient,
  phone: string,
  excludeTenantId?: string,
) {
  const digits = normalizeWasupPhone(phone);
  if (!digits) return null;

  let query = supabase
    .from("tenants")
    .select("id, name, wasup_instance_id")
    .eq("wasup_phone", digits)
    .not("wasup_instance_id", "is", null);

  if (excludeTenantId) query = query.neq("id", excludeTenantId);

  const { data } = await query.maybeSingle();
  return data;
}

/** One WhatsApp number should map to one tenant instance. */
export async function clearWasupPhoneFromOthers(
  supabase: SupabaseClient,
  phone: string,
  ownerTenantId: string,
): Promise<void> {
  const digits = normalizeWasupPhone(phone);
  if (!digits) return;

  await supabase
    .from("tenants")
    .update({ wasup_phone: null })
    .eq("wasup_phone", digits)
    .neq("id", ownerTenantId);
}

export async function linkWasupInstance(
  supabase: SupabaseClient,
  tenantId: string,
  instanceId: string,
  opts?: { phone?: string; onboardingStatus?: string; wasupApiKey?: string | null },
): Promise<void> {
  const patch: Record<string, string> = {
    wasup_instance_id: instanceId,
    onboarding_status: opts?.onboardingStatus ?? "whatsapp_connecting",
  };

  if (opts?.phone) {
    const digits = normalizeWasupPhone(opts.phone);
    await clearWasupPhoneFromOthers(supabase, digits, tenantId);
    patch.wasup_phone = digits;
  }

  if (opts?.wasupApiKey) {
    patch.wasup_api_key = opts.wasupApiKey;
  }

  await supabase.from("tenants").update(patch).eq("id", tenantId);
}

export async function markWasupConnected(
  supabase: SupabaseClient,
  tenantId: string,
  instanceId: string,
  phone?: string | null,
): Promise<void> {
  const patch: Record<string, string> = {
    wasup_instance_id: instanceId,
    onboarding_status: "whatsapp_connected",
  };

  if (phone) {
    const digits = normalizeWasupPhone(String(phone));
    await clearWasupPhoneFromOthers(supabase, digits, tenantId);
    patch.wasup_phone = digits;
  }

  await supabase.from("tenants").update(patch).eq("id", tenantId);
}

/** Drop a stale Wasup instance id when the worker no longer has it. */
export async function clearWasupInstanceLink(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<void> {
  await supabase
    .from("tenants")
    .update({
      wasup_instance_id: null,
      wasup_api_key: null,
      wasup_phone: null,
      onboarding_status: "agent_ready",
    })
    .eq("id", tenantId);
}

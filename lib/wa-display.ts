/**
 * The linked WhatsApp number. Only ever the number actually paired to WhatsApp
 * (wasup_phone) — never the garage's Google Places landline, which is not a
 * WhatsApp number and would be misleading to show as "connected".
 */
export function waLinkPhone(tenant: {
  wasup_instance_id?: string | null;
  wasup_phone?: string | null;
  phone?: string | null;
} | null | undefined): string {
  return tenant?.wasup_phone ?? "";
}

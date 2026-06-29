export function displayWaPhone(value: string): string {
  const digits = (value || "").replace(/\D/g, "");
  if (!digits) return "No number linked";
  return digits.startsWith("44")
    ? `+44 ${digits.slice(2, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`
    : `+${digits}`;
}

export type WaLinkPhase = "status" | "linking" | "change_phone";

export const INSTANCE_KEY = "rapidmot.wasup.instanceId";

export async function syncStoredWasupInstance(tenantId: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const stored = localStorage.getItem(INSTANCE_KEY);
  if (!stored) return false;
  try {
    const res = await fetch("/api/wasup/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId, instanceId: stored }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

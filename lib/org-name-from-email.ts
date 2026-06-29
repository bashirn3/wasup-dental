/** Garage-style org label from a sign-in email — prefers the domain stem. */
export function orgNameFromEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.indexOf("@");
  if (at === -1) return trimmed || "My garage";

  const domain = trimmed.slice(at + 1);
  if (!domain) return "My garage";

  const stem = domain.split(".")[0] ?? domain;
  if (!stem) return domain;
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

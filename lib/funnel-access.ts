/**
 * Who may see the attribution funnel, and how much of it.
 *
 * Two audiences, deliberately kept apart:
 *
 *   - Internal admins see every practice. That is our own commercial view of the
 *     whole book, and it is also the list that grants access to every practice's
 *     dashboard elsewhere in the app.
 *   - A named practice contact sees their own practice and nothing else. Their
 *     access is granted by name rather than inferred from membership, so nobody
 *     gains a revenue view simply by being invited to a workspace.
 *
 * Kept in one module because both the server gate and the account menu need the
 * same answer, and three separate hardcoded lists is what we already had.
 */

const INTERNAL_ADMIN_DEFAULTS = [
  "bashir@tryrapidscreen.com",
  "arslan@tryrapidscreen.com",
  "asif@smilefast.com",
];

/**
 * Practice contacts trusted with their own practice's funnel.
 *
 * Sheri runs Dental Aesthetica's side of this and is the reason the funnel is
 * scoped at all: before it was, the only way to show her DA was to show her
 * Regent's and NuYu's revenue too.
 */
const FUNNEL_CLIENT_DEFAULTS = ["sheri@dentalaesthetica.co.uk"];

/**
 * Env additions are read on the server only. In the browser bundle the variable
 * is undefined, so the account menu falls back to the names above: someone added
 * by env may not see the menu link, but the page itself still admits them. The
 * server is the gate; the menu is a convenience.
 */
function emailSet(defaults: string[], envValue: string | undefined): Set<string> {
  return new Set(
    [...defaults, ...(envValue ?? "").split(",")].map((email) => email.trim().toLowerCase()).filter(Boolean),
  );
}

export function internalAdminEmails(): Set<string> {
  return emailSet(INTERNAL_ADMIN_DEFAULTS, process.env.INTERNAL_ADMIN_EMAILS);
}

export function funnelClientEmails(): Set<string> {
  return emailSet(FUNNEL_CLIENT_DEFAULTS, process.env.FUNNEL_CLIENT_EMAILS);
}

/** Whether this person should be offered the funnel at all, at any scope. */
export function canOpenFunnel(email: string | null | undefined): boolean {
  const normalized = (email ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return internalAdminEmails().has(normalized) || funnelClientEmails().has(normalized);
}

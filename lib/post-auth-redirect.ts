/** Central post-auth hop: garage on file → dashboard, otherwise onboarding. */
export const POST_AUTH_REDIRECT = "/auth/continue";

export type PostAuthDestination = "/dashboard" | "/start?resume=1";

/** Client-side: check whether the signed-in user already has a garage. */
export async function fetchPostAuthDestination(): Promise<PostAuthDestination> {
  try {
    const res = await fetch("/api/tenant", { cache: "no-store", credentials: "include" });
    if (!res.ok) return "/start?resume=1";
    const data = await res.json();
    return data.tenant?.id ? "/dashboard" : "/start?resume=1";
  } catch {
    return "/start?resume=1";
  }
}

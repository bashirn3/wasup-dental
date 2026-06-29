import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "./supabase";

export function clerkEnabled(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
  );
}

export type ClerkIdentity = {
  userId: string | null;
  orgId: string | null;
};

export async function currentClerkIdentity(): Promise<ClerkIdentity> {
  if (!clerkEnabled()) return { userId: null, orgId: null };
  const { userId, orgId } = await auth();
  return { userId: userId ?? null, orgId: orgId ?? null };
}

/** Signed-in Clerk user id, or null (also null when Clerk isn't configured). */
export async function currentUserId(): Promise<string | null> {
  const { userId } = await currentClerkIdentity();
  return userId;
}

/**
 * Resolve the tenant for this request. With Clerk configured, the tenant is
 * looked up by the active organization and any client-supplied id is ignored.
 * Without Clerk (bare local dev), falls back to the client-supplied id.
 *
 * Legacy rows may still have clerk_org_id = user_xxx from the original v1
 * user-bound model. When an owner has an active org, migrate that binding lazily.
 */
export async function resolveTenantId(
  clientFallback?: string | null,
): Promise<string | null> {
  if (!clerkEnabled()) return clientFallback ?? null;
  const { userId, orgId } = await currentClerkIdentity();
  if (!userId) return null;
  const supabase = supabaseAdmin();
  if (!supabase) return null;

  if (orgId) {
    const { data: orgTenant } = await supabase
      .from("tenants")
      .select("id")
      .eq("clerk_org_id", orgId)
      .maybeSingle();
    if (orgTenant?.id) return orgTenant.id;
  }

  const { data: legacyTenant } = await supabase
    .from("tenants")
    .select("id")
    .eq("clerk_org_id", userId)
    .maybeSingle();

  if (legacyTenant?.id && orgId) {
    const { error } = await supabase
      .from("tenants")
      .update({ clerk_org_id: orgId, clerk_owner_user_id: userId })
      .eq("id", legacyTenant.id);
    if (error) {
      console.warn("tenant org lazy migration failed:", error.message);
    }
  }

  if (orgId) return legacyTenant?.id ?? null;

  const { data: ownerTenant } = await supabase
    .from("tenants")
    .select("id")
    .eq("clerk_owner_user_id", userId)
    .maybeSingle();
  if (ownerTenant?.id) return ownerTenant.id;

  return legacyTenant?.id ?? null;
}

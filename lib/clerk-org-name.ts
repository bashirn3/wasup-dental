import { clerkClient } from "@clerk/nextjs/server";
import { clerkEnabled } from "@/lib/auth";

type SyncClerkOrganizationNameParams = {
  organizationId: string | null;
  name: string | null | undefined;
};

function normalizeOrgName(name: string | null | undefined): string | null {
  const normalized = (name ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.slice(0, 256);
}

/**
 * Keeps the Clerk workspace label aligned with the garage profile.
 *
 * Best-effort by design: tenant save should still complete if Clerk is delayed
 * or an older local/dev environment has organizations disabled.
 */
export async function syncClerkOrganizationName({
  organizationId,
  name,
}: SyncClerkOrganizationNameParams): Promise<void> {
  const orgName = normalizeOrgName(name);
  if (!clerkEnabled() || !organizationId || !orgName) return;

  try {
    const client = await clerkClient();
    const organization = await client.organizations.getOrganization({ organizationId });
    if (organization.name === orgName) return;

    await client.organizations.updateOrganization(organizationId, { name: orgName });
  } catch (err) {
    console.warn("clerk org name sync skipped:", {
      organizationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

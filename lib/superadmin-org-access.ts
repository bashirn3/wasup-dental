import { clerkClient } from "@clerk/nextjs/server";
import { clerkEnabled } from "@/lib/auth";

const SUPERADMIN_EMAILS = [
  "bashir@tryrapidscreen.com",
  "arslan@tryrapidscreen.com",
] as const;
const SUPERADMIN_ROLE = "org:admin" as const;

type SyncSuperadminOrgAccessParams = {
  organizationId: string | null;
  ownerUserId: string | null;
  origin?: string;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function invitationRedirectUrl(origin?: string): string | undefined {
  const base = (process.env.APP_BASE_URL || origin || "").replace(/\/+$/, "");
  return base ? `${base}/auth/continue` : undefined;
}

/**
 * Gives Wasup operators admin access to each garage org.
 *
 * This is deliberately best-effort: customer onboarding should not fail because
 * Clerk could not invite/promote an internal operator at that exact moment.
 */
export async function syncSuperadminOrgAccess({
  organizationId,
  ownerUserId,
  origin,
}: SyncSuperadminOrgAccessParams): Promise<void> {
  if (!clerkEnabled() || !organizationId) return;

  try {
    const client = await clerkClient();
    const redirectUrl = invitationRedirectUrl(origin);
    const pendingInvitations = await client.organizations.getOrganizationInvitationList({
      organizationId,
      status: ["pending"],
      limit: 100,
    });

    await Promise.all(
      SUPERADMIN_EMAILS.map(async (email) => {
        const normalizedEmail = normalizeEmail(email);

        try {
          const users = await client.users.getUserList({
            emailAddress: [normalizedEmail],
            limit: 1,
          });
          const user = users.data[0];

          if (user?.id) {
            if (user.id === ownerUserId) return;

            const memberships = await client.organizations.getOrganizationMembershipList({
              organizationId,
              userId: [user.id],
              limit: 1,
            });
            const membership = memberships.data[0];

            if (membership?.role === SUPERADMIN_ROLE) return;

            if (membership) {
              await client.organizations.updateOrganizationMembership({
                organizationId,
                userId: user.id,
                role: SUPERADMIN_ROLE,
              });
              return;
            }

            await client.organizations.createOrganizationMembership({
              organizationId,
              userId: user.id,
              role: SUPERADMIN_ROLE,
            });
            return;
          }

          const pendingInvite = pendingInvitations.data.find(
            (invite) => normalizeEmail(invite.emailAddress) === normalizedEmail,
          );

          if (pendingInvite?.role === SUPERADMIN_ROLE) return;

          if (pendingInvite) {
            await client.organizations.revokeOrganizationInvitation({
              organizationId,
              invitationId: pendingInvite.id,
              requestingUserId: ownerUserId ?? undefined,
            });
          }

          await client.organizations.createOrganizationInvitation({
            organizationId,
            emailAddress: normalizedEmail,
            role: SUPERADMIN_ROLE,
            inviterUserId: ownerUserId ?? undefined,
            redirectUrl,
          });
        } catch (err) {
          console.warn("superadmin org access sync failed:", {
            organizationId,
            email: normalizedEmail,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );
  } catch (err) {
    console.warn("superadmin org access sync skipped:", {
      organizationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

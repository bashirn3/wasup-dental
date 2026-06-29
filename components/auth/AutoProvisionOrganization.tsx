"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useOrganizationCreationDefaults,
  useOrganizationList,
  useSession,
  useUser,
} from "@clerk/nextjs";
import AuthLoadingScreen from "@/components/auth/AuthLoadingScreen";
import AuthTaskShell from "@/components/auth/AuthTaskShell";
import { orgNameFromEmail } from "@/lib/org-name-from-email";
import { fetchPostAuthDestination } from "@/lib/post-auth-redirect";

/**
 * Silently creates (or selects) a Clerk Organization named from the user's email
 * domain, then activates it so the choose-organization session task completes
 * without showing Clerk's picker UI.
 */
export default function AutoProvisionOrganization() {
  const router = useRouter();
  const { user, isLoaded: userLoaded } = useUser();
  const { session, isLoaded: sessionLoaded } = useSession();
  const {
    isLoaded: orgListLoaded,
    userMemberships,
    createOrganization,
    setActive,
  } = useOrganizationList({ userMemberships: { infinite: true } });
  const { data: defaults, isLoading: defaultsLoading } = useOrganizationCreationDefaults();
  const started = useRef(false);
  const [error, setError] = useState("");
  const [selectingOrgId, setSelectingOrgId] = useState("");
  const memberships = userMemberships?.data ?? [];

  const continueWithOrganization = async (organizationId: string) => {
    if (!setActive || selectingOrgId) return;
    setSelectingOrgId(organizationId);
    try {
      await setActive({ organization: organizationId, session: session?.id ?? undefined });
      await new Promise((r) => setTimeout(r, 400));
      router.replace(await fetchPostAuthDestination());
    } catch {
      setError("Couldn't open that workspace. Please try signing in again.");
      setSelectingOrgId("");
    }
  };

  useEffect(() => {
    if (started.current || error) return;
    if (!userLoaded || !sessionLoaded || !orgListLoaded || defaultsLoading) return;
    if (!createOrganization || !setActive) return;

    started.current = true;

    void (async () => {
      try {
        if (memberships.length === 1) {
          const existing = memberships[0]?.organization;
          if (!existing?.id) throw new Error("missing_org");
          await setActive({ organization: existing.id, session: session?.id ?? undefined });
          await new Promise((r) => setTimeout(r, 400));
          router.replace(await fetchPostAuthDestination());
          return;
        }

        if (memberships.length > 1) {
          started.current = false;
          return;
        }

        const email =
          user?.primaryEmailAddress?.emailAddress ??
          user?.emailAddresses?.[0]?.emailAddress ??
          "";
        const baseName = defaults?.form?.name?.trim() || (email ? orgNameFromEmail(email) : "My garage");
        const slug = defaults?.form?.slug?.trim() || undefined;

        let org = await createOrganization({ name: baseName, slug }).catch(() => null);
        if (!org?.id && email) {
          const local = email.split("@")[0]?.replace(/[^a-z0-9]+/gi, "") || "garage";
          org = await createOrganization({
            name: baseName,
            slug: slug ? `${slug}-${local}` : undefined,
          });
        }

        if (!org?.id) throw new Error("create_failed");

        await setActive({ organization: org.id, session: session?.id ?? undefined });
        // Brief pause so Clerk promotes pending → active before we hit protected APIs.
        await new Promise((r) => setTimeout(r, 400));
        router.replace(await fetchPostAuthDestination());
      } catch {
        setError("Couldn't finish account setup. Please try signing in again.");
        started.current = false;
      }
    })();
  }, [
    userLoaded,
    sessionLoaded,
    orgListLoaded,
    defaultsLoading,
    user,
    session,
    memberships,
    defaults,
    createOrganization,
    setActive,
    router,
    error,
  ]);

  if (error) {
    return (
      <main className="rm-auth">
        <div className="rm-form-area" style={{ justifyContent: "center" }}>
          <div className="rm-sheet">
            <div className="rm-form-inner">
              <p className="rm-error" style={{ textAlign: "center" }}>
                {error}
              </p>
              <button
                type="button"
                className="rm-btn rm-btn-primary"
                onClick={() => router.replace("/sign-in")}
              >
                Back to sign in
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (memberships.length > 1) {
    return (
      <AuthTaskShell
        title="Choose workspace"
        subtitle="Pick the garage workspace you want to open."
      >
        <div className="flex flex-col gap-2">
          {memberships.map((membership) => {
            const org = membership.organization;
            return (
              <button
                key={org.id}
                type="button"
                className="rm-btn rm-btn-secondary justify-between"
                disabled={Boolean(selectingOrgId)}
                onClick={() => void continueWithOrganization(org.id)}
              >
                <span>{org.name}</span>
                {selectingOrgId === org.id && <span>Opening...</span>}
              </button>
            );
          })}
        </div>
      </AuthTaskShell>
    );
  }

  return <AuthLoadingScreen />;
}

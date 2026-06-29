"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useSession } from "@clerk/nextjs";
import AuthLoadingScreen from "@/components/auth/AuthLoadingScreen";
import AutoProvisionOrganization from "@/components/auth/AutoProvisionOrganization";
import { clerkTaskUrl } from "@/lib/clerk-tasks";
import { fetchPostAuthDestination } from "@/lib/post-auth-redirect";

/** How long to wait for Clerk to finish establishing a session after OAuth. */
const SESSION_WAIT_MS = 12_000;

/**
 * Post-auth router. Runs client-side and waits for Clerk to establish the
 * session after an OAuth redirect — the old code marked the hop as "handled"
 * on the first isLoaded tick while isSignedIn was still false, which bounced
 * new Google sign-ups straight back to /sign-in.
 */
export default function AuthContinue() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const { session, isLoaded: sessionLoaded } = useSession();
  const routed = useRef(false);

  useEffect(() => {
    if (!isLoaded || !sessionLoaded || routed.current) return;

    const task = session?.currentTask;
    if (session?.status === "pending" && task?.key === "choose-organization") {
      return;
    }
    if (session?.status === "pending" && task?.key) {
      const taskUrl = clerkTaskUrl(task.key);
      if (taskUrl) {
        routed.current = true;
        router.replace(taskUrl);
        return;
      }
    }

    if (isSignedIn) {
      routed.current = true;
      void (async () => {
        const dest = await fetchPostAuthDestination();
        router.replace(dest);
      })();
    }
  }, [isLoaded, sessionLoaded, isSignedIn, session, router]);

  /* Only give up after the wait window — pending sessions route above, not here. */
  useEffect(() => {
    if (!isLoaded || !sessionLoaded || routed.current) return;

    const t = setTimeout(() => {
      if (routed.current) return;
      if (session?.status === "pending") return;

      routed.current = true;
      router.replace("/sign-in");
    }, SESSION_WAIT_MS);

    return () => clearTimeout(t);
  }, [isLoaded, sessionLoaded, isSignedIn, session, router]);

  if (
    sessionLoaded &&
    session?.status === "pending" &&
    session.currentTask?.key === "choose-organization"
  ) {
    return <AutoProvisionOrganization />;
  }

  return <AuthLoadingScreen />;
}

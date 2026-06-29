"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useSession } from "@clerk/nextjs";
import { clerkTaskUrl } from "@/lib/clerk-tasks";
import { fetchPostAuthDestination } from "@/lib/post-auth-redirect";

/**
 * Silently routes already-signed-in users away from auth pages.
 * Returns true while a redirect is in progress so forms can stay hidden.
 */
export function useSignedInRedirect() {
  const router = useRouter();
  const { isSignedIn, isLoaded } = useAuth();
  const { session, isLoaded: sessionLoaded } = useSession();
  const redirecting = useRef(false);

  const goToDestination = useCallback(async () => {
    if (redirecting.current) return;
    redirecting.current = true;
    const dest = await fetchPostAuthDestination();
    router.replace(dest);
  }, [router]);

  useEffect(() => {
    if (!isLoaded || !sessionLoaded || redirecting.current) return;

    const task = session?.currentTask;
    if (session?.status === "pending" && task?.key) {
      const taskUrl = clerkTaskUrl(task.key);
      if (taskUrl) {
        redirecting.current = true;
        router.replace(taskUrl);
        return;
      }
    }

    if (isSignedIn) void goToDestination();
  }, [isLoaded, sessionLoaded, isSignedIn, session, goToDestination, router]);

  const redirectIfSignedIn = useCallback(async (): Promise<boolean> => {
    if (session?.status === "pending") return false;
    if (!isSignedIn) return false;
    await goToDestination();
    return true;
  }, [isSignedIn, session, goToDestination]);

  return {
    isLoaded,
    isSignedIn,
    redirectIfSignedIn,
    /** True only when an authenticated user is being routed away — not while Clerk boots for guests. */
    isRedirecting:
      isLoaded &&
      sessionLoaded &&
      (isSignedIn ||
        (session?.status === "pending" && Boolean(session?.currentTask?.key))),
  };
}

"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@clerk/nextjs";
import { clerkTaskUrl } from "@/lib/clerk-tasks";

/**
 * Sends users with a pending Clerk session (e.g. choose-organization) to the
 * matching task page. Also recovers legacy hash URLs like
 * /sign-in#/tasks/choose-organization that Clerk used before taskUrls existed.
 */
export default function AuthPendingTaskRedirect() {
  const router = useRouter();
  const { session, isLoaded } = useSession();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;

    const hash = window.location.hash;
    if (hash.includes("/tasks/choose-organization")) {
      handled.current = true;
      router.replace("/tasks/choose-organization" + window.location.search);
      return;
    }
    if (hash.includes("/tasks/reset-password")) {
      handled.current = true;
      router.replace("/tasks/reset-password" + window.location.search);
      return;
    }
    if (hash.includes("/tasks/setup-mfa")) {
      handled.current = true;
      router.replace("/tasks/setup-mfa" + window.location.search);
    }
  }, [router]);

  useEffect(() => {
    if (!isLoaded || handled.current) return;

    const task = session?.currentTask;
    if (session?.status === "pending" && task?.key) {
      const url = clerkTaskUrl(task.key);
      if (url) {
        handled.current = true;
        router.replace(url + window.location.search);
      }
    }
  }, [isLoaded, session, router]);

  return null;
}

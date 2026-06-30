"use client";

import { useClerk, useSignIn, useSignUp } from "@clerk/nextjs";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import AuthLoadingScreen from "@/components/auth/AuthLoadingScreen";
import ClerkCaptcha from "@/components/auth/ClerkCaptcha";
import type { SessionTask } from "@clerk/shared/types";
import { clerkTaskUrl } from "@/lib/clerk-tasks";
import { CLERK_SIGN_IN_URL, CLERK_SIGN_UP_URL } from "@/lib/clerk-urls";
import { ensureClerkDevBypassReady, isClerkDevPkClient } from "@/lib/clerk-dev-bypass";
import { POST_AUTH_REDIRECT } from "@/lib/post-auth-redirect";

function navigateToUrl(router: ReturnType<typeof useRouter>, url: string) {
  if (url.startsWith("http")) {
    window.location.href = url;
    return;
  }
  router.replace(url);
}

function navigateAfterAuth(
  router: ReturnType<typeof useRouter>,
  decorateUrl: (url: string) => string,
  session?: { currentTask?: { key: SessionTask["key"] } | null },
) {
  const task = session?.currentTask;
  if (task?.key) {
    const taskUrl = clerkTaskUrl(task.key);
    if (taskUrl) {
      navigateToUrl(router, decorateUrl(taskUrl));
      return;
    }
  }
  navigateToUrl(router, decorateUrl(POST_AUTH_REDIRECT));
}

/**
 * OAuth return handler — Clerk v7 finalize() flow with dev CAPTCHA bypass.
 * Avoids HandleSSOCallback's always-on #clerk-captcha (Turnstile) on dev instances.
 */
export default function SsoCallbackClient() {
  const clerk = useClerk();
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const router = useRouter();
  const hasRun = useRef(false);

  // Safety net: if Clerk returns an unexpected OAuth state, none of the
  // branches below match and the page would spin forever. Bounce back to
  // sign-in after a wait so the user can retry (or use email instead).
  useEffect(() => {
    const t = setTimeout(() => {
      navigateToUrl(router, `${CLERK_SIGN_IN_URL}?error=oauth_timeout`);
    }, 15_000);
    return () => clearTimeout(t);
  }, [router]);

  useEffect(() => {
    void (async () => {
      if (!clerk.loaded || hasRun.current) return;

      if (isClerkDevPkClient()) {
        await ensureClerkDevBypassReady();
      }

      hasRun.current = true;

      if (signIn.status === "complete") {
        await signIn.finalize({
          navigate: async ({ session, decorateUrl }) => {
            navigateAfterAuth(router, decorateUrl, session);
          },
        });
        return;
      }

      if (signUp.isTransferable) {
        await signIn.create({ transfer: true });
        const signInStatus = signIn.status as typeof signIn.status | "complete";
        if (signInStatus === "complete") {
          await signIn.finalize({
            navigate: async ({ session, decorateUrl }) => {
              navigateAfterAuth(router, decorateUrl, session);
            },
          });
          return;
        }
        navigateToUrl(router, CLERK_SIGN_IN_URL);
        return;
      }

      if (
        signIn.status === "needs_first_factor" &&
        !signIn.supportedFirstFactors?.every((f) => f.strategy === "enterprise_sso")
      ) {
        navigateToUrl(router, CLERK_SIGN_IN_URL);
        return;
      }

      if (signIn.isTransferable) {
        await signUp.create({ transfer: true });
        if (signUp.status === "complete") {
          await signUp.finalize({
            navigate: async ({ session, decorateUrl }) => {
              navigateAfterAuth(router, decorateUrl, session);
            },
          });
          return;
        }
        navigateToUrl(router, CLERK_SIGN_UP_URL);
        return;
      }

      if (signUp.status === "complete") {
        await signUp.finalize({
          navigate: async ({ session, decorateUrl }) => {
            navigateAfterAuth(router, decorateUrl, session);
          },
        });
        return;
      }

      if (signIn.status === "needs_second_factor" || signIn.status === "needs_new_password") {
        navigateToUrl(router, CLERK_SIGN_IN_URL);
        return;
      }

      if (signIn.existingSession || signUp.existingSession) {
        const sessionId =
          signIn.existingSession?.sessionId || signUp.existingSession?.sessionId;
        if (sessionId) {
          await clerk.setActive({
            session: sessionId,
            navigate: async ({ session, decorateUrl }) => {
              navigateAfterAuth(router, decorateUrl, session);
            },
          });
        }
      }
    })();
  }, [clerk, clerk.loaded, signIn, signUp, router]);

  return (
    <>
      <ClerkCaptcha />
      <AuthLoadingScreen label="Completing Google sign-in…" />
    </>
  );
}

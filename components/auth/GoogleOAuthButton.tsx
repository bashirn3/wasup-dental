"use client";

import { useState } from "react";
import { useSignIn } from "@clerk/nextjs";
import GoogleIcon from "@/components/auth/GoogleIcon";
import { useSignedInRedirect } from "@/components/auth/useSignedInRedirect";
import { clerkErrorMessage, isAlreadySignedInError } from "@/lib/clerk-errors";
import { CLERK_SSO_CALLBACK_URL } from "@/lib/clerk-urls";
import { POST_AUTH_REDIRECT } from "@/lib/post-auth-redirect";

type Props = {
  label?: string;
  onError?: (message: string) => void;
};

/**
 * Google OAuth via Clerk v7 `signIn.sso()` — stays on our custom auth UI
 * instead of redirecting to the hosted Account Portal.
 */
export default function GoogleOAuthButton({
  label = "Continue with Google",
  onError,
}: Props) {
  const { signIn, fetchStatus } = useSignIn();
  const { redirectIfSignedIn } = useSignedInRedirect();
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (!signIn || loading || fetchStatus === "fetching") return;
    if (await redirectIfSignedIn()) return;

    setLoading(true);
    if (onError) onError("");

    try {
      const { error } = await signIn.sso({
        strategy: "oauth_google",
        redirectCallbackUrl: CLERK_SSO_CALLBACK_URL,
        redirectUrl: POST_AUTH_REDIRECT,
      });

      if (error) {
        throw error;
      }
    } catch (err) {
      if (isAlreadySignedInError(err)) {
        await redirectIfSignedIn();
        return;
      }
      onError?.(clerkErrorMessage(err, "Google sign-in failed. Try again."));
      setLoading(false);
    }
  }

  const busy = loading || fetchStatus === "fetching";

  return (
    <button
      className="rm-btn rm-btn-google rm-fade-up"
      type="button"
      onClick={() => void handleClick()}
      disabled={busy}
    >
      <GoogleIcon />
      {busy ? "Redirecting…" : label}
    </button>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSignUp } from "@clerk/nextjs/legacy";
import ClerkBadge from "@/components/auth/ClerkBadge";
import GoogleOAuthButton from "@/components/auth/GoogleOAuthButton";
import { useSignedInRedirect } from "@/components/auth/useSignedInRedirect";
import { clerkErrorMessage, isAlreadySignedInError } from "@/lib/clerk-errors";
import { POST_AUTH_REDIRECT } from "@/lib/post-auth-redirect";

type Step = "identifier" | "password" | "email_code";

const REDIRECT =
  process.env.NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL ?? POST_AUTH_REDIRECT;
const DESKTOP_EMAIL_PLACEHOLDER = "you@workshop.co.uk";
const MOBILE_EMAIL_PLACEHOLDER = "Email address";

export default function SignUpForm() {
  const router = useRouter();
  const { isLoaded, signUp, setActive } = useSignUp();
  const { redirectIfSignedIn, isRedirecting } = useSignedInRedirect();

  const [step, setStep] = useState<Step>("identifier");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailPlaceholder, setEmailPlaceholder] = useState(DESKTOP_EMAIL_PLACEHOLDER);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 899px)");
    const updatePlaceholder = () => {
      setEmailPlaceholder(media.matches ? MOBILE_EMAIL_PLACEHOLDER : DESKTOP_EMAIL_PLACEHOLDER);
    };

    updatePlaceholder();
    media.addEventListener("change", updatePlaceholder);
    return () => media.removeEventListener("change", updatePlaceholder);
  }, []);

  async function handleClerkError(err: unknown, fallback: string) {
    if (isAlreadySignedInError(err)) {
      await redirectIfSignedIn();
      return;
    }
    setError(clerkErrorMessage(err, fallback));
  }

  async function finishSignUp() {
    if (!signUp?.createdSessionId) return;
    await setActive!({ session: signUp.createdSessionId });
    router.push(REDIRECT);
  }

  async function handleIdentifier(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || !signUp) return;
    if (await redirectIfSignedIn()) return;
    setError("");
    setLoading(true);
    try {
      await signUp.create({ emailAddress: email.trim() });

      if (signUp.status === "complete") {
        await finishSignUp();
        return;
      }

      if (signUp.unverifiedFields.includes("email_address")) {
        await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
        setStep("email_code");
      } else if (signUp.missingFields.includes("password")) {
        setStep("password");
      } else {
        setError("Unable to create account with this email.");
      }
    } catch (err) {
      await handleClerkError(err, "Could not create account. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || !signUp) return;
    if (await redirectIfSignedIn()) return;
    setError("");
    setLoading(true);
    try {
      await signUp.update({ password });

      if (signUp.status === "complete") {
        await finishSignUp();
        return;
      }

      if (signUp.unverifiedFields.includes("email_address")) {
        await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
        setStep("email_code");
      }
    } catch (err) {
      await handleClerkError(err, "Could not set password. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleEmailCode(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || !signUp) return;
    if (await redirectIfSignedIn()) return;
    setError("");
    setLoading(true);
    try {
      await signUp.attemptEmailAddressVerification({ code });

      if (signUp.status === "complete") {
        await finishSignUp();
        return;
      }

      if (signUp.missingFields.includes("password")) {
        setStep("password");
      }
    } catch (err) {
      await handleClerkError(err, "Invalid code. Try again.");
    } finally {
      setLoading(false);
    }
  }

  if (isRedirecting) {
    return <div className="rm-form" aria-busy="true" />;
  }

  const clerkReady = isLoaded && signUp;

  if (step === "password") {
    return (
      <form className="rm-form rm-fade-up" onSubmit={handlePassword}>
        <p className="rm-step-hint">Creating account for</p>
        <p className="rm-step-email">{email}</p>
        {error && <p className="rm-error">{error}</p>}
        <div className="rm-field">
          <label className="rm-label" htmlFor="sign-up-password">
            Password
          </label>
          <input
            id="sign-up-password"
            className="rm-input"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoFocus
          />
        </div>
        <button className="rm-btn rm-btn-primary" type="submit" disabled={loading}>
          {loading ? (
            "Creating…"
          ) : (
            <>
              Continue <span className="rm-btn-arrow" aria-hidden>-&gt;</span>
            </>
          )}
        </button>
        <button
          className="rm-btn rm-btn-ghost"
          type="button"
          onClick={() => {
            setStep("identifier");
            setPassword("");
            setError("");
          }}
        >
          Use a different email
        </button>
        <ClerkBadge />
      </form>
    );
  }

  if (step === "email_code") {
    return (
      <form className="rm-form rm-fade-up" onSubmit={handleEmailCode}>
        <p className="rm-step-hint">Enter the code sent to</p>
        <p className="rm-step-email">{email}</p>
        {error && <p className="rm-error">{error}</p>}
        <div className="rm-field">
          <label className="rm-label" htmlFor="sign-up-code">
            Verification code
          </label>
          <input
            id="sign-up-code"
            className="rm-input"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            autoFocus
          />
        </div>
        <button className="rm-btn rm-btn-primary" type="submit" disabled={loading}>
          {loading ? (
            "Verifying…"
          ) : (
            <>
              Continue <span className="rm-btn-arrow" aria-hidden>-&gt;</span>
            </>
          )}
        </button>
        <button
          className="rm-btn rm-btn-ghost"
          type="button"
          onClick={() => {
            setStep("identifier");
            setCode("");
            setError("");
          }}
        >
          Use a different email
        </button>
        <ClerkBadge />
      </form>
    );
  }

  return (
    <>
      <div className="rm-form">
        <GoogleOAuthButton onError={setError} />

        <div className="rm-divider rm-fade-up rm-fade-up-delay-1" aria-hidden>
          or
        </div>

        <form className="rm-form rm-fade-up rm-fade-up-delay-2" onSubmit={handleIdentifier}>
          {error && <p className="rm-error">{error}</p>}
          <div className="rm-field">
            <label className="rm-label" htmlFor="sign-up-email">
              Email address
            </label>
            <input
              id="sign-up-email"
              className="rm-input"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder={emailPlaceholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <button className="rm-btn rm-btn-primary" type="submit" disabled={loading || !clerkReady}>
            {loading ? (
              "Continuing…"
            ) : (
              <>
                Continue <span className="rm-btn-arrow" aria-hidden>-&gt;</span>
              </>
            )}
          </button>
        </form>
      </div>

      <p className="rm-alt rm-fade-up rm-fade-up-delay-3">
        Already have an account?{" "}
        <Link className="rm-alt-link" href="/sign-in">
          Sign in
        </Link>
      </p>

      <ClerkBadge />
    </>
  );
}

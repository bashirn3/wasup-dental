"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSignIn } from "@clerk/nextjs/legacy";
import ClerkBadge from "@/components/auth/ClerkBadge";
import GoogleOAuthButton from "@/components/auth/GoogleOAuthButton";
import { useSignedInRedirect } from "@/components/auth/useSignedInRedirect";
import { clerkErrorMessage, isAlreadySignedInError } from "@/lib/clerk-errors";
import { POST_AUTH_REDIRECT } from "@/lib/post-auth-redirect";

type Step = "identifier" | "password" | "email_code" | "second_factor";

/** Email/password completion — env override still allowed for legacy flows. */
const REDIRECT =
  process.env.NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL ?? POST_AUTH_REDIRECT;
const DESKTOP_EMAIL_PLACEHOLDER = "you@practice.co.uk";
const MOBILE_EMAIL_PLACEHOLDER = "Email address";

export default function SignInForm() {
  const router = useRouter();
  const { isLoaded, signIn, setActive } = useSignIn();
  const { redirectIfSignedIn, isRedirecting } = useSignedInRedirect();

  const [step, setStep] = useState<Step>("identifier");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailPlaceholder, setEmailPlaceholder] = useState(DESKTOP_EMAIL_PLACEHOLDER);
  const [emailCodeFactorId, setEmailCodeFactorId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "oauth_timeout") {
      setError("Google sign-in didn't complete. Try again, or use your email and password below.");
    }
  }, []);

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

  async function finishSignIn(sessionId?: string | null) {
    const nextSessionId = sessionId ?? signIn?.createdSessionId;
    if (!nextSessionId) {
      setError("Sign-in completed, but no session was returned. Please try again.");
      return;
    }
    await setActive!({ session: nextSessionId });
    router.push(REDIRECT);
  }

  async function prepareEmailCodeSignIn(factorId = emailCodeFactorId) {
    if (!signIn || !factorId) {
      setError("Email code sign-in is not available for this account.");
      return false;
    }

    await signIn.prepareFirstFactor({
      strategy: "email_code",
      emailAddressId: factorId,
    });
    setCode("");
    setStep("email_code");
    return true;
  }

  async function handleIdentifier(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || !signIn) return;
    if (await redirectIfSignedIn()) return;
    setError("");
    setLoading(true);
    try {
      const signInAttempt = await signIn.create({ identifier: email.trim() });

      if (signInAttempt.status === "complete") {
        await finishSignIn(signInAttempt.createdSessionId);
        return;
      }

      const firstFactors = signInAttempt.supportedFirstFactors ?? signIn.supportedFirstFactors;
      const passwordFactor = firstFactors?.find(
        (f) => f.strategy === "password",
      );
      const emailCodeFactor = firstFactors?.find(
        (f) => f.strategy === "email_code",
      );
      const nextEmailCodeFactorId =
        emailCodeFactor && "emailAddressId" in emailCodeFactor ? emailCodeFactor.emailAddressId : null;
      setEmailCodeFactorId(nextEmailCodeFactorId);

      if (passwordFactor) {
        setStep("password");
      } else if (nextEmailCodeFactorId) {
        await prepareEmailCodeSignIn(nextEmailCodeFactorId);
      } else {
        setError("No sign-in method available for this email.");
      }
    } catch (err) {
      await handleClerkError(err, "Could not continue. Check your email and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || !signIn) return;
    if (await redirectIfSignedIn()) return;
    setError("");
    setLoading(true);
    try {
      const signInAttempt = await signIn.attemptFirstFactor({ strategy: "password", password });

      if (signInAttempt.status === "complete") {
        await finishSignIn(signInAttempt.createdSessionId);
        return;
      }

      if (signInAttempt.status === "needs_second_factor") {
        const secondFactors = signInAttempt.supportedSecondFactors ?? signIn.supportedSecondFactors;
        const emailCode = secondFactors?.find(
          (f) => f.strategy === "email_code",
        );
        if (emailCode && "emailAddressId" in emailCode) {
          await signIn.prepareSecondFactor({
            strategy: "email_code",
            emailAddressId: emailCode.emailAddressId,
          });
          setStep("second_factor");
        } else {
          setError("Additional verification is required.");
        }
        return;
      }

      const fallbackFactors = signInAttempt.supportedFirstFactors ?? signIn.supportedFirstFactors;
      const emailCode = fallbackFactors?.find((f) => f.strategy === "email_code");
      const fallbackFactorId = emailCode && "emailAddressId" in emailCode ? emailCode.emailAddressId : emailCodeFactorId;
      if (fallbackFactorId) {
        setEmailCodeFactorId(fallbackFactorId);
        await prepareEmailCodeSignIn(fallbackFactorId);
        return;
      }

      setError(`Sign-in could not complete (${signInAttempt.status}). Please restart sign-in.`);
    } catch (err) {
      await handleClerkError(err, "Incorrect password. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleEmailCode(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || !signIn) return;
    if (await redirectIfSignedIn()) return;
    setError("");
    setLoading(true);
    try {
      const strategy = step === "second_factor" ? "email_code" : "email_code";
      const signInAttempt = step === "second_factor"
        ? await signIn.attemptSecondFactor({ strategy, code })
        : await signIn.attemptFirstFactor({ strategy, code });

      if (signInAttempt.status === "complete") {
        await finishSignIn(signInAttempt.createdSessionId);
        return;
      }

      setError(`Verification did not complete (${signInAttempt.status}). Please request a new code and try again.`);
    } catch (err) {
      await handleClerkError(err, "Invalid code. Try again.");
    } finally {
      setLoading(false);
    }
  }

  if (isRedirecting) {
    return <div className="rm-form" aria-busy="true" />;
  }

  const clerkReady = isLoaded && signIn;

  if (step === "password") {
    return (
      <form className="rm-form rm-fade-up" onSubmit={handlePassword}>
        <p className="rm-step-hint">Signing in as</p>
        <p className="rm-step-email">{email}</p>
        {error && <p className="rm-error">{error}</p>}
        <div className="rm-field">
          <label className="rm-label" htmlFor="sign-in-password">
            Password
          </label>
          <input
            id="sign-in-password"
            className="rm-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
          />
        </div>
        <button className="rm-btn rm-btn-primary" type="submit" disabled={loading}>
          {loading ? (
            "Signing in…"
          ) : (
            <>
              Continue <span className="rm-btn-arrow" aria-hidden>-&gt;</span>
            </>
          )}
        </button>
        {emailCodeFactorId ? (
          <button
            className="rm-btn rm-btn-secondary"
            type="button"
            disabled={loading}
            onClick={() => void prepareEmailCodeSignIn()}
          >
            Email me a code instead
          </button>
        ) : null}
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

  if (step === "email_code" || step === "second_factor") {
    return (
      <form className="rm-form rm-fade-up" onSubmit={handleEmailCode}>
        <p className="rm-step-hint">Enter the code sent to</p>
        <p className="rm-step-email">{email}</p>
        {error && <p className="rm-error">{error}</p>}
        <div className="rm-field">
          <label className="rm-label" htmlFor="sign-in-code">
            Verification code
          </label>
          <input
            id="sign-in-code"
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
            <label className="rm-label" htmlFor="sign-in-email">
              Email address
            </label>
            <input
              id="sign-in-email"
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
        New here?{" "}
        <Link className="rm-alt-link" href="/sign-up">
          Create an account
        </Link>
      </p>

      <ClerkBadge />
    </>
  );
}

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

  async function finishSignIn() {
    if (!signIn?.createdSessionId) return;
    await setActive!({ session: signIn.createdSessionId });
    router.push(REDIRECT);
  }

  async function handleIdentifier(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || !signIn) return;
    if (await redirectIfSignedIn()) return;
    setError("");
    setLoading(true);
    try {
      await signIn.create({ identifier: email.trim() });

      if (signIn.status === "complete") {
        await finishSignIn();
        return;
      }

      const passwordFactor = signIn.supportedFirstFactors?.find(
        (f) => f.strategy === "password",
      );
      const emailCodeFactor = signIn.supportedFirstFactors?.find(
        (f) => f.strategy === "email_code",
      );

      if (passwordFactor) {
        setStep("password");
      } else if (emailCodeFactor && "emailAddressId" in emailCodeFactor) {
        await signIn.prepareFirstFactor({
          strategy: "email_code",
          emailAddressId: emailCodeFactor.emailAddressId,
        });
        setStep("email_code");
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
      await signIn.attemptFirstFactor({ strategy: "password", password });

      if (signIn.status === "complete") {
        await finishSignIn();
        return;
      }

      if (signIn.status === "needs_second_factor") {
        const emailCode = signIn.supportedSecondFactors?.find(
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
      }
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
      if (step === "second_factor") {
        await signIn.attemptSecondFactor({ strategy, code });
      } else {
        await signIn.attemptFirstFactor({ strategy, code });
      }

      if (signIn.status === "complete") {
        await finishSignIn();
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

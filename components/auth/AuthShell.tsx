import type { ReactNode } from "react";
import Link from "next/link";
import AuthPendingTaskRedirect from "@/components/auth/AuthPendingTaskRedirect";
import ClerkCaptcha from "@/components/auth/ClerkCaptcha";

type Props = {
  mode: "sign-in" | "sign-up";
  children: ReactNode;
};

export default function AuthShell({ mode, children }: Props) {
  const isSignIn = mode === "sign-in";
  const title = isSignIn ? "Sign in" : "Create account";
  const subtitle = isSignIn
    ? "Continue with Google or enter your email to open the dashboard."
    : "Continue with Google or enter your email to start with RapidMOT.";

  return (
    <main className="rm-auth">
      <AuthPendingTaskRedirect />
      <section className="rm-brand" aria-label="RapidMOT">
        <Link href="/" className="rm-logo rm-fade-in">
          Rapid<span className="rm-logo-accent">MOT</span>
        </Link>

        <div className="rm-watermark-text" aria-hidden>
          MOT
        </div>

        <div className="rm-brand-copy">
          <h2 className="rm-brand-headline">
            Every MOT lead, answered before the kettle boils.
          </h2>
          <p className="rm-brand-desc">
            Your leads kept moving while you were away. Sign in to catch up.
          </p>
        </div>
      </section>

      <div className="rm-form-area">
        <div className="rm-sheet">
          <div className="rm-handle" aria-hidden />
          <div className="rm-form-inner">
            <div className="rm-card-header">
              <h1 className="rm-title">{title}</h1>
              <p className="rm-card-subtitle">{subtitle}</p>
            </div>
            {children}
            <ClerkCaptcha />
          </div>
        </div>
      </div>
    </main>
  );
}

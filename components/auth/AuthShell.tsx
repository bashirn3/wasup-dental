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
    ? "Continue with Google or enter your email to open your workspace."
    : "Continue with Google or enter your email to set up your practice.";

  return (
    <main className="rm-auth">
      <AuthPendingTaskRedirect />
      <section className="rm-brand" aria-label="Wasup Dental">
        <Link href="/" className="rm-logo rm-fade-in">
          Wasup<span className="rm-logo-accent">Dental</span>
        </Link>

        <div className="rm-watermark-text" aria-hidden>
          WD
        </div>

        <div className="rm-brand-copy">
          <h2 className="rm-brand-headline">
            Every dental lead, followed up with care.
          </h2>
          <p className="rm-brand-desc">
            Open your workspace to review replies, bookings, and patient conversations.
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

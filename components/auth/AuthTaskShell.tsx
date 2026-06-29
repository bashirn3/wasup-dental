import type { ReactNode } from "react";
import Link from "next/link";

type Props = {
  title: string;
  subtitle: string;
  children: ReactNode;
};

/** Shared shell for Clerk post-auth session tasks (org pick, MFA, etc.). */
export default function AuthTaskShell({ title, subtitle, children }: Props) {
  return (
    <main className="rm-auth">
      <section className="rm-brand" aria-label="RapidMOT">
        <Link href="/" className="rm-logo rm-fade-in">
          Rapid<span className="rm-logo-accent">MOT</span>
        </Link>

        <div className="rm-watermark-text" aria-hidden>
          MOT
        </div>

        <div className="rm-brand-copy">
          <h2 className="rm-brand-headline">Almost there — one quick step.</h2>
          <p className="rm-brand-desc">Finish this step and we&apos;ll take you straight to your garage.</p>
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
            <div className="rm-form rm-form-inner">{children}</div>
          </div>
        </div>
      </div>
    </main>
  );
}

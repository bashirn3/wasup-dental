"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

const fade = (delay: number) => ({
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] as const },
});

export default function Landing() {
  return (
    <main className="flex min-h-dvh flex-col bg-pine text-paper">
      <header className="flex items-center justify-between px-6 pt-6 sm:px-10">
        <motion.span {...fade(0)} className="text-lg font-semibold tracking-tight">
          Wasup<span className="text-lime">Dental</span>
        </motion.span>
        <motion.div {...fade(0.05)}>
          <Link
            href="/dashboard"
            className="text-sm text-paper/70 transition hover:text-paper"
          >
            Sign in
          </Link>
        </motion.div>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <motion.p
          {...fade(0.1)}
          className="mb-5 rounded-full border border-paper/15 px-4 py-1.5 text-xs uppercase tracking-[0.2em] text-paper/60"
        >
          For dental practices
        </motion.p>
        <h1 className="max-w-3xl text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
          {["Follow up dental leads", "from one clean workspace."].map((line, i) => (
            <span key={line} className="block overflow-hidden pb-[0.08em]">
              <motion.span
                className={`block ${i === 1 ? "text-lime" : ""}`}
                initial={{ y: "115%" }}
                animate={{ y: 0 }}
                transition={{
                  duration: 0.8,
                  delay: 0.18 + i * 0.12,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                {line}
              </motion.span>
            </span>
          ))}
        </h1>
        <motion.p
          {...fade(0.32)}
          className="mt-6 max-w-md text-balance text-base text-paper/65 sm:text-lg"
        >
          Manage patient conversations, assistant replies, and booking follow-up without jumping between tools.
        </motion.p>
        <motion.div {...fade(0.44)} className="mt-10">
          <Link
            href="/start?new=1"
            className="inline-flex items-center gap-3 rounded-full bg-lime px-8 py-4 text-base font-semibold text-pine-deep shadow-[0_12px_40px_-12px_rgba(205,244,99,0.6)] transition hover:scale-[1.03] active:scale-[0.98]"
          >
            Set up a practice
            <ArrowRight className="h-5 w-5" aria-hidden />
          </Link>
        </motion.div>
      </section>

      <motion.footer
        {...fade(0.6)}
        className="flex items-center justify-center gap-8 px-6 pb-8 text-xs text-paper/40"
      >
        <span>WhatsApp follow-up</span>
        <span>Booking-ready</span>
        <span>Built for dental teams</span>
      </motion.footer>
    </main>
  );
}

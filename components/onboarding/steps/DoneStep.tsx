"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import AnimatedCheck from "@/components/ui/AnimatedCheck";
import {
  isCompleteOnboardingDraft,
  ONBOARDING_SYNCED_TENANT_KEY,
  TENANT_ID_KEY,
} from "@/lib/onboarding-storage";
import type { OnboardingDraft } from "@/lib/types";

type Props = { draft: OnboardingDraft; onBack: () => void };

type SaveState = "saving" | "saved" | "local" | "error" | "auth" | "claimed";

const SESSION_RETRY_ATTEMPTS = 5;
const DENTAL_TREATMENTS = [
  { id: "class-1", label: "Invisalign" },
  { id: "class-2", label: "Implants" },
  { id: "class-3", label: "Composite bonding" },
  { id: "class-4", label: "Whitening" },
  { id: "class-5", label: "Veneers" },
  { id: "class-7", label: "Emergency" },
] as const;

export default function DoneStep({ draft, onBack }: Props) {
  const { isSignedIn, isLoaded } = useAuth();
  const [save, setSave] = useState<SaveState>("saving");

  useEffect(() => {
    if (!isLoaded) return;

    let cancelled = false;

    (async () => {
      if (!isCompleteOnboardingDraft(draft)) {
        if (!cancelled) setSave("error");
        return;
      }

      for (let attempt = 1; attempt <= SESSION_RETRY_ATTEMPTS && !cancelled; attempt++) {
        if (!cancelled) setSave("saving");

        try {
          const res = await fetch("/api/tenant", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(draft),
          });

          if (res.status === 401) {
            if (isSignedIn && attempt < SESSION_RETRY_ATTEMPTS) {
              // Clerk session may not have propagated to the server yet.
              await new Promise((r) => setTimeout(r, 300 * attempt));
              continue;
            }
            if (!cancelled) setSave(isSignedIn ? "error" : "auth");
            return;
          }

          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            if (!cancelled) {
              setSave(data.error === "practice_already_claimed" ? "claimed" : "error");
            }
            return;
          }

          if (data.tenantId) {
            localStorage.setItem(TENANT_ID_KEY, data.tenantId);
            localStorage.setItem(ONBOARDING_SYNCED_TENANT_KEY, data.tenantId);
          }
          if (!cancelled) setSave(data.storage === "supabase" ? "saved" : "local");
          return;
        } catch {
          if (!cancelled) setSave("error");
          return;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [draft, isLoaded, isSignedIn]);

  const chosen = DENTAL_TREATMENTS.filter((c) => draft.classes.includes(c.id));

  return (
    <motion.section
      className="whatsapp-chat-bg absolute inset-0 z-10 flex flex-col items-center justify-center overflow-hidden px-5"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="absolute inset-0 bg-pine-deep/35" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_28%,rgba(205,244,99,0.18),transparent_34%),linear-gradient(180deg,rgba(9,42,32,0.15),rgba(9,42,32,0.75))]" />

      <div className="relative z-10 flex flex-col items-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.15 }}
          className="flex h-20 w-20 items-center justify-center rounded-full bg-lime shadow-[0_18px_70px_-24px_rgba(205,244,99,0.9)]"
        >
          <AnimatedCheck className="h-10 w-10 text-pine-deep" />
        </motion.div>

        <h1 className="mt-6 text-balance text-center text-3xl font-semibold tracking-tight text-paper drop-shadow">
          {draft.place?.name ?? "Your practice"} is ready.
        </h1>
        <p className="mt-2 max-w-sm text-center text-sm text-paper/70">
          {chosen.map((c) => c.label).join(", ")} ·{" "}
          {draft.freeRetest ? "staff approval on" : "direct booking draft"} · {draft.tone} tone
        </p>

        <p className="mt-3 text-xs text-paper/50">
          {!isLoaded && "Checking account…"}
          {isLoaded && save === "saving" && "Saving..."}
          {isLoaded && save === "saved" && "Saved to your workspace"}
          {isLoaded && save === "local" && "Saved locally until Supabase is connected"}
          {isLoaded && save === "error" && "Couldn't sync yet. We kept your local copy."}
          {isLoaded && save === "claimed" && "This practice is already claimed by another account."}
          {isLoaded && save === "auth" && "One last thing: an account keeps your workspace safe"}
        </p>

        <div className="mt-10 flex flex-col items-center gap-3">
          {save === "auth" ? (
            <Link
              href="/sign-up"
              className="inline-flex items-center gap-2 rounded-full bg-lime px-10 py-4 text-base font-semibold text-pine-deep shadow-[0_12px_40px_-12px_rgba(205,244,99,0.6)] transition hover:scale-[1.03] active:scale-[0.98]"
            >
              Create my free account <ArrowRight className="h-5 w-5" />
            </Link>
          ) : (
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-full bg-lime px-10 py-4 text-base font-semibold text-pine-deep shadow-[0_12px_40px_-12px_rgba(205,244,99,0.6)] transition hover:scale-[1.03] active:scale-[0.98]"
            >
              Open dashboard <ArrowRight className="h-5 w-5" />
            </Link>
          )}
          <button
            onClick={onBack}
            className="text-sm text-paper/60 transition hover:text-paper"
          >
            Go back and tweak
          </button>
        </div>
      </div>
    </motion.section>
  );
}

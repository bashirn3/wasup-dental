"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import type { AgentTone, OnboardingDraft } from "@/lib/types";

type Props = {
  draft: OnboardingDraft;
  onChange: (draft: OnboardingDraft) => void;
  onBack: () => void;
  onNext: () => void;
};

const TONES: { id: AgentTone; label: string; sample: string }[] = [
  {
    id: "friendly",
    label: "Friendly",
    sample: "Hi Sarah, it is the clinic. Would you like help finding a consultation slot?",
  },
  {
    id: "professional",
    label: "Professional",
    sample: "Hello Sarah, we can help with your treatment enquiry. Shall I check consultation availability?",
  },
  {
    id: "straight-talking",
    label: "Straight-talking",
    sample: "Sarah, we have consultation times this week. Want me to check one for you?",
  },
];

function formatPrice(value: number): string {
  return value === 0 ? "Free" : `£${value}`;
}

const DENTAL_TREATMENTS = [
  { id: "class-1", label: "Invisalign consultation", description: "Aligner enquiries", suggested: 0 },
  { id: "class-2", label: "Implant consultation", description: "Implant enquiries", suggested: 50 },
  { id: "class-3", label: "Composite bonding consultation", description: "Cosmetic bonding", suggested: 0 },
  { id: "class-4", label: "Whitening consultation", description: "Whitening leads", suggested: 0 },
  { id: "class-5", label: "Veneers consultation", description: "Cosmetic veneers", suggested: 50 },
  { id: "class-7", label: "Emergency appointment", description: "Urgent dental cases", suggested: 75 },
] as const;

export default function DetailsStep({ draft, onChange, onBack, onNext }: Props) {
  const chosen = DENTAL_TREATMENTS.filter((c) => draft.classes.includes(c.id));

  return (
    <motion.section
      className="absolute inset-0 z-10 flex flex-col px-5 pt-16"
      initial={{ opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -24 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className="flex-shrink-0 pb-4 text-center">
        <h1 className="text-balance text-3xl font-semibold tracking-tight text-paper">
          Consultation rules &amp; style
        </h1>
        <p className="mt-2 text-sm text-paper/60">
          Set guide consultation fees and the tone for first replies.
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto pb-32">
        <div className="w-full max-w-md space-y-3">
          {chosen.map((c) => {
            const suggested = c.suggested;
            const min = 0;
            const max = suggested + 150;
            const value = draft.prices[c.id] ?? suggested;

            return (
              <div
                key={c.id}
                className="rounded-card bg-white/10 px-5 py-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <span>
                    <span className="font-semibold text-paper">{c.label}</span>
                    <span className="ml-2 text-xs text-paper/55">{c.description}</span>
                  </span>
                  <span className="shrink-0 text-xl font-semibold tabular-nums text-lime">
                    {formatPrice(value)}
                  </span>
                </div>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={1}
                  value={value}
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      prices: {
                        ...draft.prices,
                        [c.id]: Number(e.target.value),
                      },
                    })
                  }
                  className="price-slider mt-3 w-full"
                  aria-label={`${c.label} price`}
                />
              </div>
            );
          })}

          <label className="flex items-center justify-between rounded-card bg-white/10 px-5 py-4">
            <span>
                <span className="font-semibold text-paper">Require staff approval before booking</span>
              <span className="block text-xs text-paper/55">
                Recommended until the Dentally flow is signed off
              </span>
            </span>
            <button
              role="switch"
              aria-checked={draft.freeRetest}
              onClick={() => onChange({ ...draft, freeRetest: !draft.freeRetest })}
              className={`relative h-7 w-12 rounded-full transition ${
                draft.freeRetest ? "bg-lime" : "bg-white/20"
              }`}
            >
              <motion.span
                className="absolute top-1 h-5 w-5 rounded-full bg-white shadow"
                initial={false}
                animate={{ left: draft.freeRetest ? 26 : 4 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            </button>
          </label>

          <div
            className="overflow-hidden rounded-card p-5"
            style={{
              backgroundImage: "url('/whatsapp-chat-bg.jpg')",
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          >
            <p className="font-semibold text-ink/85">How should your agent sound?</p>
            <div className="mt-3 flex gap-2">
              {TONES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onChange({ ...draft, tone: t.id })}
                  className={`flex-1 rounded-full px-3 py-2 text-xs font-medium transition active:scale-[0.97] ${
                    draft.tone === t.id
                      ? "bg-[#25D366] text-white shadow-sm"
                      : "bg-white/75 text-ink/70 hover:bg-white/90"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <motion.p
              key={draft.tone}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 rounded-2xl rounded-bl-sm bg-white/90 px-4 py-3 text-sm text-ink"
            >
              {TONES.find((t) => t.id === draft.tone)?.sample}
            </motion.p>
          </div>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 flex justify-center gap-3 bg-gradient-to-t from-pine-deep via-pine-deep/90 to-transparent px-5 pb-6 pt-10">
        <button
          onClick={onBack}
          className="rounded-full border border-white/20 px-6 py-3.5 text-sm font-medium text-paper/80 transition hover:bg-white/10 active:scale-[0.98]"
        >
          Back
        </button>
        <button
          onClick={onNext}
          className="inline-flex items-center gap-2 rounded-full bg-lime px-10 py-3.5 text-sm font-semibold text-pine-deep transition hover:brightness-105 active:scale-[0.98]"
        >
          Create draft agent <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </motion.section>
  );
}

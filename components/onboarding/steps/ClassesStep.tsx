"use client";

import { motion } from "framer-motion";
import { ArrowRight, Smile, Sparkles, Stethoscope, Syringe, Wand2 } from "lucide-react";
import type { MotClassId } from "@/lib/types";

const DENTAL_TREATMENTS: {
  id: MotClassId;
  label: string;
  description: string;
  Icon: typeof Smile;
}[] = [
  { id: "class-1", label: "Invisalign", description: "Aligner consultations", Icon: Smile },
  { id: "class-2", label: "Implants", description: "Single and multiple implants", Icon: Syringe },
  { id: "class-3", label: "Composite bonding", description: "Cosmetic bonding leads", Icon: Sparkles },
  { id: "class-4", label: "Whitening", description: "Whitening and smile refresh", Icon: Wand2 },
  { id: "class-5", label: "Veneers", description: "Cosmetic veneer enquiries", Icon: Smile },
  { id: "class-7", label: "Emergency", description: "Urgent dental enquiries", Icon: Stethoscope },
];

type Props = {
  selected: MotClassId[];
  onChange: (classes: MotClassId[]) => void;
  onBack: () => void;
  onNext: () => void;
};

export default function ClassesStep({ selected, onChange, onBack, onNext }: Props) {
  const toggle = (id: MotClassId) =>
    onChange(
      selected.includes(id)
        ? selected.filter((c) => c !== id)
        : [...selected, id],
    );

  return (
    <motion.section
      className="absolute inset-0 z-10 flex flex-col items-center overflow-y-auto px-5 pb-32 pt-16"
      initial={{ opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -24 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <h1 className="text-balance text-center text-3xl font-semibold tracking-tight text-paper">
        Which treatments should the agent handle?
      </h1>
      <p className="mt-2 text-sm text-paper/60">Tap all that apply.</p>

      <div className="mt-8 grid w-full max-w-md grid-cols-2 gap-3">
        {DENTAL_TREATMENTS.map((c, i) => {
          const active = selected.includes(c.id);
          const Icon = c.Icon;
          return (
            <motion.button
              key={c.id}
              onClick={() => toggle(c.id)}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * i, duration: 0.4 }}
              whileTap={{ scale: 0.96 }}
              className={`flex flex-col items-start rounded-card p-4 text-left transition ${
                active
                  ? "bg-lime text-pine-deep shadow-[0_12px_40px_-12px_rgba(205,244,99,0.5)]"
                  : "bg-white/10 text-paper hover:bg-white/15"
              }`}
            >
              <Icon className="h-7 w-7" strokeWidth={1.75} />
              <span className="mt-2 font-semibold">{c.label}</span>
              <span
                className={`mt-0.5 text-xs ${active ? "text-pine-deep/70" : "text-paper/55"}`}
              >
                {c.description}
              </span>
            </motion.button>
          );
        })}
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
          disabled={selected.length === 0}
          className="inline-flex items-center gap-2 rounded-full bg-lime px-10 py-3.5 text-sm font-semibold text-pine-deep transition enabled:hover:brightness-105 enabled:active:scale-[0.98] disabled:opacity-40"
        >
          Continue <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </motion.section>
  );
}

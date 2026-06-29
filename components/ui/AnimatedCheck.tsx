"use client";

import { motion } from "framer-motion";

/** A check mark that draws itself in. Use inside the lime success circles. */
export default function AnimatedCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <motion.path
        d="M4.5 12.5l5 5L19.5 6.5"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.3, ease: [0.65, 0, 0.35, 1] }}
      />
    </svg>
  );
}

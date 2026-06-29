"use client";

import { motion } from "framer-motion";

/**
 * Soft fade between routes. Opacity only, deliberately: transforms on an
 * ancestor would break position:fixed children (tab bar, sheets).
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="flex min-h-dvh flex-col"
    >
      {children}
    </motion.div>
  );
}

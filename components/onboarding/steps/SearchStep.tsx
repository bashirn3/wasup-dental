"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { GaragePlace } from "@/lib/types";

type Props = { onSelect: (place: GaragePlace) => void };

export default function SearchStep({ onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GaragePlace[]>([]);
  const [loading, setLoading] = useState(false);
  const [isMock, setIsMock] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/places/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: `${query} dental practice dentist` }),
        });
        const data = await res.json();
        setResults(data.places ?? []);
        setIsMock(Boolean(data.mock));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  return (
    <motion.section
      className="absolute inset-x-0 top-0 z-10 flex flex-col items-center px-5 pt-20"
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -24 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <h1 className="text-balance text-center text-3xl font-semibold tracking-tight text-paper sm:text-4xl">
        What&apos;s your dental practice called?
      </h1>
      <p className="mt-2 text-sm text-paper/60">
        We&apos;ll pull the address, website, phone, and map position.
      </p>

      <div className="mt-8 w-full max-w-md">
        <div className="relative">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Regent Dental, London"
            className="w-full rounded-2xl border border-white/10 bg-white/95 px-5 py-4 text-base text-ink shadow-2xl outline-none ring-lime/60 placeholder:text-ink/35 focus:ring-4"
          />
          {loading && (
            <span className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin rounded-full border-2 border-pine/20 border-t-pine" />
          )}
        </div>

        {results.length > 0 && (
          <motion.ul
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 overflow-hidden rounded-2xl bg-white/95 shadow-2xl"
          >
            {results.map((p, i) => (
              <motion.li
                key={p.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                <button
                  onClick={() => onSelect(p)}
                  className={`flex w-full flex-col items-start px-5 py-3.5 text-left transition hover:bg-mist active:bg-mist ${
                    i > 0 ? "border-t border-line" : ""
                  }`}
                >
                  <span className="font-medium text-ink">{p.name}</span>
                  <span className="text-sm text-ink/55">{p.address}</span>
                </button>
              </motion.li>
            ))}
            {isMock && (
              <li className="border-t border-line bg-mist/60 px-5 py-2 text-xs text-ink/45">
                Demo results. Add GOOGLE_MAPS_API_KEY for live search
              </li>
            )}
          </motion.ul>
        )}
      </div>
    </motion.section>
  );
}

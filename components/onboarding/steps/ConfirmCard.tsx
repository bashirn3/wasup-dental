"use client";

import { motion } from "framer-motion";
import { ArrowRight, Star } from "lucide-react";
import type { GaragePlace } from "@/lib/types";

type Props = {
  place: GaragePlace;
  onConfirm: () => void;
  onReject: () => void;
};

function todayHours(openingHours: string[]): string | null {
  if (openingHours.length !== 7) return null;
  // Google weekdayDescriptions start on Monday.
  const idx = (new Date().getDay() + 6) % 7;
  const line = openingHours[idx];
  return line?.split(": ").slice(1).join(": ") ?? null;
}

export default function ConfirmCard({ place, onConfirm, onReject }: Props) {
  const hours = todayHours(place.openingHours);

  return (
    <motion.section
      className="absolute inset-x-0 bottom-0 z-10 px-4 pb-6 sm:mx-auto sm:max-w-md"
      initial={{ y: "110%" }}
      animate={{ y: 0 }}
      exit={{ y: "110%" }}
      transition={{ type: "spring", stiffness: 160, damping: 22, delay: 1.6 }}
    >
      <div className="rounded-card bg-white/95 p-6 shadow-2xl backdrop-blur">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-ink">
              {place.name}
            </h2>
            <p className="mt-1 text-sm text-ink/55">{place.address}</p>
          </div>
          {place.rating !== null && (
            <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-pine px-3 py-1.5 text-sm font-medium text-lime">
              <Star className="h-3.5 w-3.5 fill-lime" /> {place.rating.toFixed(1)}
              {place.ratingCount !== null && (
                <span className="text-paper/50">({place.ratingCount})</span>
              )}
            </span>
          )}
        </div>

        <dl className="mt-4 space-y-2 text-sm">
          {place.phone && (
            <div className="flex gap-2">
              <dt className="text-ink/40">Phone</dt>
              <dd className="font-medium text-ink">{place.phone}</dd>
            </div>
          )}
          {hours && (
            <div className="flex gap-2">
              <dt className="text-ink/40">Today</dt>
              <dd className="font-medium text-ink">{hours}</dd>
            </div>
          )}
          {place.category && (
            <div className="flex gap-2">
              <dt className="text-ink/40">Listed as</dt>
              <dd className="font-medium text-ink">{place.category}</dd>
            </div>
          )}
        </dl>

        <div className="mt-6 flex gap-3">
          <button
            onClick={onReject}
            className="flex-1 rounded-full border border-line px-5 py-3.5 text-sm font-medium text-ink/70 transition hover:bg-mist active:scale-[0.98]"
          >
            Not it
          </button>
          <button
            onClick={onConfirm}
            className="inline-flex flex-[2] items-center justify-center gap-2 rounded-full bg-pine px-5 py-3.5 text-sm font-semibold text-lime transition hover:brightness-110 active:scale-[0.98]"
          >
            That&apos;s our practice <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </motion.section>
  );
}

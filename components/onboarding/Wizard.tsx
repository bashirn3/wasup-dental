"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import GarageMap, { UK_OVERVIEW, type MapTarget } from "@/components/GarageMap";
import type { GaragePlace, OnboardingDraft } from "@/lib/types";
import {
  EMPTY_ONBOARDING_DRAFT,
  ONBOARDING_DRAFT_KEY,
  ONBOARDING_STEP_KEY,
  parseOnboardingDraft,
} from "@/lib/onboarding-storage";
import SearchStep from "./steps/SearchStep";
import ConfirmCard from "./steps/ConfirmCard";
import ClassesStep from "./steps/ClassesStep";
import DetailsStep from "./steps/DetailsStep";
import DoneStep from "./steps/DoneStep";

type Step = "search" | "confirm" | "classes" | "details" | "done";

const STEPS: Step[] = ["search", "confirm", "classes", "details", "done"];

export default function Wizard() {
  const [step, setStep] = useState<Step>("search");
  const [draft, setDraft] = useState<OnboardingDraft>(EMPTY_ONBOARDING_DRAFT);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const savedStep = localStorage.getItem(ONBOARDING_STEP_KEY) as Step | null;
      const shouldStartFresh =
        params.get("new") === "1" ||
        (params.get("resume") !== "1" && savedStep === "done");

      if (shouldStartFresh) {
        localStorage.removeItem(ONBOARDING_DRAFT_KEY);
        localStorage.removeItem(ONBOARDING_STEP_KEY);
        return;
      }

      const restored = parseOnboardingDraft(localStorage.getItem(ONBOARDING_DRAFT_KEY));
      if (!restored) return;
      setDraft(restored);
      // Resume where they left off (e.g. returning from the sign-up redirect).
      if (savedStep && STEPS.includes(savedStep) && restored.place) {
        setStep(savedStep);
      }
    } catch {
      /* fresh start */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* storage unavailable */
    }
  }, [draft]);

  useEffect(() => {
    try {
      localStorage.setItem(ONBOARDING_STEP_KEY, step);
    } catch {
      /* storage unavailable */
    }
  }, [step]);

  const target: MapTarget = useMemo(() => {
    if (draft.place && step !== "search") {
      return { lng: draft.place.lng, lat: draft.place.lat, zoom: 16.4, pitch: 52 };
    }
    return UK_OVERVIEW;
  }, [draft.place, step]);

  const selectPlace = useCallback((place: GaragePlace) => {
    setDraft((d) => ({ ...d, place }));
    setStep("confirm");
  }, []);

  const resetSearch = useCallback(() => {
    setDraft((d) => ({ ...d, place: null }));
    setStep("search");
  }, []);

  const mapDimmed = step === "classes" || step === "details" || step === "done";

  return (
    <main className="relative h-dvh overflow-hidden bg-pine">
      <GarageMap
        target={target}
        marker={draft.place && step !== "search" ? draft.place : null}
        className="absolute inset-0 h-full w-full"
      />

      {/* Scrims keep the copy legible over light map tiles */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[38%] bg-gradient-to-b from-pine-deep/85 via-pine-deep/40 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-pine-deep/70 to-transparent" />

      {/* Dim + blur the map when the focus moves to forms */}
      <motion.div
        className="pointer-events-none absolute inset-0 bg-pine-deep/70 backdrop-blur-md"
        initial={false}
        animate={{ opacity: mapDimmed ? 1 : 0 }}
        transition={{ duration: 0.6 }}
      />

      {/* Progress dots */}
      <div className="absolute left-1/2 top-5 z-20 flex -translate-x-1/2 gap-2">
        {(["search", "classes", "details", "done"] as const).map((s, i) => {
          const order: Record<Step, number> = {
            search: 0,
            confirm: 0,
            classes: 1,
            details: 2,
            done: 3,
          };
          const active = order[step] >= i;
          return (
            <motion.span
              key={s}
              className="h-1.5 rounded-full bg-lime"
              initial={false}
              animate={{
                width: active ? 28 : 10,
                opacity: active ? 1 : 0.3,
              }}
              transition={{ type: "spring", stiffness: 300, damping: 28 }}
            />
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        {step === "search" && (
          <SearchStep key="search" onSelect={selectPlace} />
        )}
        {step === "confirm" && draft.place && (
          <ConfirmCard
            key="confirm"
            place={draft.place}
            onConfirm={() => setStep("classes")}
            onReject={resetSearch}
          />
        )}
        {step === "classes" && (
          <ClassesStep
            key="classes"
            selected={draft.classes}
            onChange={(classes) => setDraft((d) => ({ ...d, classes }))}
            onBack={() => setStep("confirm")}
            onNext={() => setStep("details")}
          />
        )}
        {step === "details" && (
          <DetailsStep
            key="details"
            draft={draft}
            onChange={setDraft}
            onBack={() => setStep("classes")}
            onNext={() => setStep("done")}
          />
        )}
        {step === "done" && (
          <DoneStep key="done" draft={draft} onBack={() => setStep("details")} />
        )}
      </AnimatePresence>
    </main>
  );
}

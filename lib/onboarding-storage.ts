import type { AgentTone, GaragePlace, OnboardingDraft } from "@/lib/types";

export const ONBOARDING_DRAFT_KEY = "rapidmot.onboarding.draft";
export const ONBOARDING_STEP_KEY = "rapidmot.onboarding.step";
export const TENANT_ID_KEY = "rapidmot.tenantId";
export const ONBOARDING_SYNCED_TENANT_KEY = "rapidmot.onboarding.syncedTenantId";

export const EMPTY_ONBOARDING_DRAFT: OnboardingDraft = {
  place: null,
  classes: [],
  prices: {},
  freeRetest: true,
  tone: "friendly",
};

const TONES: AgentTone[] = ["friendly", "professional", "straight-talking"];
const MOT_CLASS_IDS: OnboardingDraft["classes"][number][] = [
  "class-1",
  "class-2",
  "class-3",
  "class-4",
  "class-5",
  "class-7",
];

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalizePlace(value: unknown): GaragePlace | null {
  const place = asObject(value);
  if (!place) return null;

  const lat = Number(place.lat);
  const lng = Number(place.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    id: typeof place.id === "string" ? place.id : "",
    name: typeof place.name === "string" ? place.name : "",
    address: typeof place.address === "string" ? place.address : "",
    phone: typeof place.phone === "string" ? place.phone : null,
    lat,
    lng,
    rating: typeof place.rating === "number" ? place.rating : null,
    ratingCount: typeof place.ratingCount === "number" ? place.ratingCount : null,
    website: typeof place.website === "string" ? place.website : null,
    openingHours: Array.isArray(place.openingHours)
      ? place.openingHours.filter((item): item is string => typeof item === "string")
      : [],
    category: typeof place.category === "string" ? place.category : null,
  };
}

export function normalizeOnboardingDraft(value: unknown): OnboardingDraft {
  const draft = asObject(value);
  if (!draft) return EMPTY_ONBOARDING_DRAFT;

  const tone =
    typeof draft.tone === "string" && TONES.includes(draft.tone as AgentTone)
      ? (draft.tone as AgentTone)
      : EMPTY_ONBOARDING_DRAFT.tone;

  return {
    place: normalizePlace(draft.place),
    classes: Array.isArray(draft.classes)
      ? (draft.classes.filter((item): item is OnboardingDraft["classes"][number] =>
          MOT_CLASS_IDS.includes(item as OnboardingDraft["classes"][number]),
        ) as OnboardingDraft["classes"])
      : [],
    prices: (asObject(draft.prices) ?? {}) as OnboardingDraft["prices"],
    freeRetest:
      typeof draft.freeRetest === "boolean"
        ? draft.freeRetest
        : EMPTY_ONBOARDING_DRAFT.freeRetest,
    tone,
  };
}

export function parseOnboardingDraft(raw: string | null): OnboardingDraft | null {
  if (!raw) return null;
  try {
    return normalizeOnboardingDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function isCompleteOnboardingDraft(
  draft: OnboardingDraft | null,
): draft is OnboardingDraft & { place: GaragePlace } {
  return Boolean(
    draft?.place?.id &&
      draft.place.name &&
      Number.isFinite(draft.place.lat) &&
      Number.isFinite(draft.place.lng) &&
      draft.classes.length > 0,
  );
}


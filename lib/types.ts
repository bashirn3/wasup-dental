export type GaragePlace = {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  lat: number;
  lng: number;
  rating: number | null;
  ratingCount: number | null;
  website: string | null;
  openingHours: string[];
  category: string | null;
};

export type MotClassId =
  | "class-1"
  | "class-2"
  | "class-3"
  | "class-4"
  | "class-5"
  | "class-7";

export type AgentTone = "friendly" | "professional" | "straight-talking";

export type OnboardingDraft = {
  place: GaragePlace | null;
  classes: MotClassId[];
  prices: Partial<Record<MotClassId, number>>;
  freeRetest: boolean;
  tone: AgentTone;
};

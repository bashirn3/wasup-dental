/**
 * Client-editable agent config — the full Agent Studio surface that practice
 * owners (e.g. Asif) edit in the dashboard. Stored inside
 * agent_control_configs.workflow_settings.clientEditable and served to the n8n
 * worker via /api/runtime-config so edits drive the live agent.
 *
 * Shared by the API (parse/merge/persist) and the UI (typed editor state).
 */

export const DENTAL_TREATMENTS = [
  "invisalign",
  "implants",
  "full_arch_implants",
  "composites",
  "whitening",
  "veneers",
  "hygiene",
] as const;

export type DentalTreatment = (typeof DENTAL_TREATMENTS)[number];

export const TREATMENT_LABELS: Record<string, string> = {
  invisalign: "Invisalign",
  implants: "Dental Implants",
  full_arch_implants: "Full Arch Implants",
  composites: "Composite Bonding",
  veneers: "Veneers",
  whitening: "Teeth Whitening",
  hygiene: "Hygiene",
};

export function treatmentLabel(id: string): string {
  return (
    TREATMENT_LABELS[id] ??
    id
      .split(/[_-]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

export type Faq = { question: string; answer: string };

/** Structured, scrape-able fact card the agent is allowed to use per treatment. */
export type TreatmentFacts = {
  generalInfo: string;
  benefits: string[];
  suitability: string[];
  process: string[];
  pricing: string;
  financeOffering: string;
  pricingOffers: string[];
  contraindications: string[];
  faqs: Faq[];
  confidence: number;
};

/** WhatsApp first-message template (interactive opener) per treatment. */
export type FirstMessageTemplate = {
  header: string;
  body: string;
  subtext: string;
  footer: string;
  buttons: string[];
};

export type MiscInfo = {
  address: string;
  phone: string;
  parking: string;
  notes: string;
};

export type ClientEditable = {
  assistantName: string;
  openingHours: string;
  closingHours: string;
  knowledge: string;
  otherMenuItems: string;
  misc: MiscInfo;
  treatmentFirstMessages: Record<string, string>;
  treatmentTemplates: Record<string, FirstMessageTemplate>;
  treatmentFacts: Record<string, TreatmentFacts>;
};

export function emptyTreatmentFacts(): TreatmentFacts {
  return {
    generalInfo: "",
    benefits: [],
    suitability: [],
    process: [],
    pricing: "",
    financeOffering: "",
    pricingOffers: [],
    contraindications: [],
    faqs: [],
    confidence: 0,
  };
}

export function emptyTemplate(): FirstMessageTemplate {
  return { header: "", body: "", subtext: "", footer: "", buttons: [] };
}

export function emptyMisc(): MiscInfo {
  return { address: "", phone: "", parking: "", notes: "" };
}

export function emptyClientEditable(): ClientEditable {
  return {
    assistantName: "",
    openingHours: "",
    closingHours: "",
    knowledge: "",
    otherMenuItems: "",
    misc: emptyMisc(),
    treatmentFirstMessages: {},
    treatmentTemplates: {},
    treatmentFacts: {},
  };
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function faqsFrom(value: unknown): Faq[] {
  if (!Array.isArray(value)) return [];
  const out: Faq[] = [];
  for (const item of value) {
    if (item && typeof item === "object") {
      const q = str((item as Record<string, unknown>).question);
      const a = str((item as Record<string, unknown>).answer);
      if (q || a) out.push({ question: q, answer: a });
    }
  }
  return out;
}

export function factsFrom(value: unknown): TreatmentFacts {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    generalInfo: str(raw.generalInfo),
    benefits: strArray(raw.benefits),
    suitability: strArray(raw.suitability),
    process: strArray(raw.process),
    pricing: str(raw.pricing),
    financeOffering: str(raw.financeOffering),
    pricingOffers: strArray(raw.pricingOffers),
    contraindications: strArray(raw.contraindications),
    faqs: faqsFrom(raw.faqs),
    confidence: num(raw.confidence),
  };
}

export function templateFrom(value: unknown): FirstMessageTemplate {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    header: str(raw.header),
    body: str(raw.body),
    subtext: str(raw.subtext),
    footer: str(raw.footer),
    buttons: strArray(raw.buttons).slice(0, 10),
  };
}

function recordOf<T>(value: unknown, map: (v: unknown) => T): Record<string, T> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, T> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = map(v);
  }
  return out;
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") out[key] = v;
  }
  return out;
}

export function miscFrom(value: unknown): MiscInfo {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    address: str(raw.address),
    phone: str(raw.phone),
    parking: str(raw.parking),
    notes: str(raw.notes),
  };
}

/** Parse a stored clientEditable blob into the fully-typed shape (safe defaults). */
export function parseClientEditable(value: unknown): ClientEditable {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    assistantName: str(raw.assistantName),
    openingHours: str(raw.openingHours),
    closingHours: str(raw.closingHours),
    knowledge: str(raw.knowledge),
    otherMenuItems: str(raw.otherMenuItems),
    misc: miscFrom(raw.misc),
    treatmentFirstMessages: stringRecord(raw.treatmentFirstMessages),
    treatmentTemplates: recordOf(raw.treatmentTemplates, templateFrom),
    treatmentFacts: recordOf(raw.treatmentFacts, factsFrom),
  };
}

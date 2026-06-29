import { buildSystemPrompt, defaultAgentConfig, type AgentConfig } from "@/lib/agent-prompt";
import type { MotClassId, OnboardingDraft } from "@/lib/types";

/** Tenant row shape as stored in Supabase (subset the engine needs). */
export type TenantRow = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  opening_hours: string[] | null;
  mot_classes: string[];
  prices: Record<string, number>;
  free_retest: boolean;
  tone: string;
  wasup_instance_id: string | null;
};

export type LeadRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string;
  registration: string | null;
  vehicle: string | null;
  mot_due_date: string | null;
  status: string;
};

/** Convert a tenant DB row back into the draft shape the prompt builder uses. */
export function tenantToDraft(t: TenantRow): OnboardingDraft {
  return {
    place: {
      id: t.id,
      name: t.name,
      address: t.address ?? "",
      phone: t.phone,
      lat: 0,
      lng: 0,
      rating: null,
      ratingCount: null,
      website: t.website,
      openingHours: t.opening_hours ?? [],
      category: null,
    },
    classes: (t.mot_classes ?? []) as MotClassId[],
    prices: t.prices ?? {},
    freeRetest: t.free_retest,
    tone: (["friendly", "professional", "straight-talking"].includes(t.tone)
      ? t.tone
      : "friendly") as OnboardingDraft["tone"],
  };
}

export function tenantSystemPrompt(t: TenantRow, config?: AgentConfig | null): string {
  const draft = tenantToDraft(t);
  return buildSystemPrompt(draft, config ?? defaultAgentConfig(draft));
}

/** Prompt for generating the personalised first outbound message for a lead. */
export function firstMessageInstruction(
  lead: LeadRow,
  daysUntilDue: number | null,
  firstMessagePrompt?: string | null,
): string {
  const name = lead.first_name ?? "";
  const vehicle = lead.vehicle ?? "";
  const reg = lead.registration ?? "";
  const due = lead.mot_due_date ?? "unknown";
  const dueDateKnown = Boolean(lead.mot_due_date && daysUntilDue !== null);
  const dueness =
    daysUntilDue === null
      ? "due date unknown"
      : daysUntilDue < 0
        ? `${Math.abs(daysUntilDue)} days OVERDUE`
        : `due in ${daysUntilDue} days`;

  return `Write the FIRST outbound WhatsApp message to this customer about their MOT. Details:
- Customer first name: ${name || "(unknown, do not guess; open without a name)"}
- Vehicle: ${vehicle || "(unknown)"}
- Registration: ${reg || "(unknown)"}
- MOT due date: ${due} (${dueness})

Rules for this message:
- 1-3 short sentences, WhatsApp style, matching your tone rules.
- ${
    dueDateKnown
      ? "Mention the due date naturally. If overdue, be helpful not alarmist."
      : "The MOT due date is unknown. Do NOT say the MOT is due, overdue, or due soon. Phrase this as a helpful check-in asking whether the vehicle may be due soon."
  }
- End with a soft booking question.
- Use this owner-approved first message as the template/style when provided, adapting only the customer, vehicle, registration, due date, and booking ask: ${firstMessagePrompt?.trim() || "(none provided)"}
- Do NOT use placeholder text. Output ONLY the message text, nothing else.`;
}

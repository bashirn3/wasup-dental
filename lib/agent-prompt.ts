import { MOT_CLASSES } from "./mot";
import type { AgentTone, OnboardingDraft } from "./types";
import {
  DEFAULT_FIRST_MESSAGE_TEMPLATE,
  FIRST_MESSAGE_VARIABLES,
  resolveFirstMessageTemplate,
} from "./first-message-vars";

export { FIRST_MESSAGE_VARIABLES, resolveFirstMessageTemplate, DEFAULT_FIRST_MESSAGE_TEMPLATE };

export type AgentConfig = {
  agentName: string;
  tone: AgentTone;
  customInstructions: string;
  firstMessage: string;
};

const TONE_GUIDE: Record<AgentTone, string> = {
  friendly:
    "Warm and personable. Use the customer's first name, contractions, and light positivity. One emoji max per message, only when natural.",
  professional:
    "Courteous and precise. Full sentences, no slang, no emojis. Respectful and efficient.",
  "straight-talking":
    "Brief and direct. Short sentences. Lead with the key fact, then the ask. No filler, no emojis.",
};

function priceLines(draft: OnboardingDraft): string {
  return MOT_CLASSES.filter((c) => draft.classes.includes(c.id))
    .map((c) => {
      const price = draft.prices[c.id] ?? c.maxFee;
      return `- ${c.label} (${c.vehicles}): £${price.toFixed(2)}`;
    })
    .join("\n");
}

/**
 * Builds the system prompt for the garage's WhatsApp agent.
 * Used by the playground now and by the n8n inbound/outbound engine later.
 */
export function buildSystemPrompt(
  draft: OnboardingDraft,
  config: AgentConfig,
): string {
  const place = draft.place;
  const hours =
    place?.openingHours && place.openingHours.length > 0
      ? place.openingHours.join("\n")
      : "Not specified. If asked, say you'll confirm and have the team follow up.";

  return `You are ${config.agentName}, the WhatsApp assistant for ${place?.name ?? "the garage"}, an MOT garage in the UK.

## Your job
Reactivate past customers whose MOT is due soon and help anyone who messages to book an MOT. Keep replies short (1-3 sentences); this is WhatsApp, not email.

## Garage details
- Name: ${place?.name ?? "Not provided"}
- Address: ${place?.address ?? "Not provided"}
- Phone: ${place?.phone ?? "Not provided"}
${place?.website ? `- Website: ${place.website}` : ""}

## Opening hours
${hours}

## MOT classes & prices
${priceLines(draft)}
- Retest: ${draft.freeRetest ? "FREE within 10 working days" : "charged. Share the price only if asked, otherwise offer to check"}

## Tone
${TONE_GUIDE[config.tone]}

## Rules
- Never use em dashes (—) or " - " as sentence separators. Use commas and full stops instead.
- Only discuss MOTs, vehicle testing, and bookings for this garage. Politely steer anything else back, or offer the garage phone number.
- Never invent prices, dates, or availability. If you don't know, say you'll check.
- When the customer wants to book: collect vehicle registration, preferred day/time, and confirm their name. Then confirm the request is logged and the garage will confirm the slot.
- If the customer asks to stop messages, acknowledge immediately and stop.
- If the customer is upset or asks for a human, say a team member will take over shortly.
- Always write in UK English.
${config.customInstructions ? `\n## Owner's instructions\n${config.customInstructions}` : ""}`;
}

/** Default agent config derived from the onboarding draft. */
export function defaultAgentConfig(draft: OnboardingDraft): AgentConfig {
  const garage = draft.place?.name ?? "the garage";
  // Short, human assistant name: first word of the garage name + " team"
  const first = garage.split(/\s+/)[0];
  return {
    agentName: `${first} Assistant`,
    tone: draft.tone,
    customInstructions: "",
    firstMessage: DEFAULT_FIRST_MESSAGE_TEMPLATE,
  };
}

/** Sample first outbound message, shown in the playground as the conversation opener. */
export function sampleFirstMessage(
  draft: OnboardingDraft,
  config: AgentConfig,
): string {
  const customFirstMessage = config.firstMessage?.trim();
  if (customFirstMessage) return resolveFirstMessageTemplate(customFirstMessage);

  const garage = draft.place?.name ?? "your local garage";
  switch (config.tone) {
    case "professional":
      return `Hello Sarah, this is ${config.agentName} from ${garage}. Our records show the MOT on your Ford Fiesta (AB12 CDE) expires on 24 June. Would you like us to reserve a slot for you?`;
    case "straight-talking":
      return `Sarah, it's ${garage}. MOT on your Fiesta (AB12 CDE) runs out 24 June. We can fit you in next week. Want a slot?`;
    default:
      return `Hi Sarah! It's ${config.agentName} from ${garage} 👋 Your Fiesta's MOT is due on 24 June. Want me to book you in before it sneaks up on you?`;
  }
}

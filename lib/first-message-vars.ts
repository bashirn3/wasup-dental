import { motStateFromDate } from "@/lib/mot";
import type { LeadRow } from "@/lib/engine/prompt";

/** Relative MOT wording for templates — "in 14 days", "86 days overdue", "due today". */
export function formatMotDueInDays(days: number | null): string {
  if (days === null) return "soon";
  if (days < 0) {
    const n = Math.abs(days);
    return `${n} day${n === 1 ? "" : "s"} overdue`;
  }
  if (days === 0) return "due today";
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

export const FIRST_MESSAGE_VARIABLES = [
  { token: "{{name}}", label: "Name", sample: "Sarah" },
  { token: "{{phone}}", label: "Mobile", sample: "+44 7835 156367" },
  { token: "{{plate}}", label: "Plate", sample: "AB12 CDE" },
  { token: "{{in_days}}", label: "In days", sample: "in 14 days" },
] as const;

/** Default outbound template — matches horatio.html seed. */
export const DEFAULT_FIRST_MESSAGE_TEMPLATE =
  "Hi {{name}}, thanks for your enquiry. Would you like help booking a consultation?";

const DEFAULT_SAMPLES = Object.fromEntries(
  FIRST_MESSAGE_VARIABLES.map((v) => [v.token, v.sample]),
) as Record<string, string>;

/** Legacy templates may still use {{due_date}} — map to relative wording, not calendar date. */
const LEGACY_ALIASES: Record<string, string> = {
  "{{due_date}}": "{{in_days}}",
};

export function leadFirstMessageVarMap(
  lead: Pick<LeadRow, "first_name" | "phone" | "registration" | "mot_due_date">,
  days: number | null = motStateFromDate(lead.mot_due_date).days,
): Record<string, string> {
  const name = (lead.first_name ?? "").trim() || "there";
  const inDays = formatMotDueInDays(days);
  return {
    "{{name}}": name,
    "{{phone}}": lead.phone ?? "",
    "{{plate}}": lead.registration?.trim() ?? "",
    "{{in_days}}": inDays,
    "{{due_date}}": inDays,
  };
}

/** Replace {{name}}, {{in_days}}, etc. (preview uses samples when no lead passed). */
export function resolveFirstMessageTemplate(
  template: string,
  vars: Record<string, string> = DEFAULT_SAMPLES,
): string {
  let out = template;
  for (const [from, to] of Object.entries(LEGACY_ALIASES)) {
    if (out.includes(from)) out = out.split(from).join(to);
  }
  for (const { token } of FIRST_MESSAGE_VARIABLES) {
    if (out.includes(token)) out = out.split(token).join(vars[token] ?? DEFAULT_SAMPLES[token] ?? "");
  }
  if (out.includes("{{due_date}}")) {
    out = out.split("{{due_date}}").join(vars["{{in_days}}"] ?? vars["{{due_date}}"] ?? "in 14 days");
  }
  return out;
}

export function resolveFirstMessageForLead(
  template: string,
  lead: Pick<LeadRow, "first_name" | "phone" | "registration" | "mot_due_date">,
): string {
  return resolveFirstMessageTemplate(template, leadFirstMessageVarMap(lead));
}

export function templateFullyResolved(text: string): boolean {
  return !/\{\{[a-z_]+\}\}/.test(text);
}

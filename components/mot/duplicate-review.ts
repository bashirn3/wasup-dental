import type { LeadVM } from "./data";

export type DuplicateTab = "all" | "duplicates" | "same-number" | "same-plate";

export type DuplicateReview = {
  label: "Exact duplicate" | "Same number" | "Same plate";
  detail: string;
};

export type DuplicateGroup = {
  key: string;
  label: string;
  type: Exclude<DuplicateTab, "all" | "duplicates">;
  leads: LeadVM[];
  suggestedKeepId: string;
};

function countBy<T>(items: T[], keyFn: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function phoneKey(lead: LeadVM): string {
  return lead.phone.replace(/\D/g, "");
}

export function plateKey(lead: LeadVM): string {
  return lead.plate.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function duplicateReviewMap(leads: LeadVM[]): Map<string, DuplicateReview> {
  const phoneCounts = countBy(leads, phoneKey);
  const plateCounts = countBy(leads, plateKey);
  const exactCounts = countBy(leads, (lead) => {
    const phone = phoneKey(lead);
    const plate = plateKey(lead);
    return phone && plate ? `${phone}|${plate}` : "";
  });

  const out = new Map<string, DuplicateReview>();
  for (const lead of leads) {
    const phone = phoneKey(lead);
    const plate = plateKey(lead);

    if (phone && plate && (exactCounts.get(`${phone}|${plate}`) ?? 0) > 1) {
      out.set(lead.id, { label: "Exact duplicate", detail: "Number and plate match another queued row" });
      continue;
    }

    if (phone && (phoneCounts.get(phone) ?? 0) > 1) {
      out.set(lead.id, { label: "Same number", detail: "Phone matches another queued row" });
      continue;
    }

    if (plate && (plateCounts.get(plate) ?? 0) > 1) {
      out.set(lead.id, { label: "Same plate", detail: "Plate matches another queued row" });
    }
  }

  return out;
}

function completenessScore(lead: LeadVM): number {
  return Number(Boolean(phoneKey(lead))) + Number(Boolean(plateKey(lead))) + Number(lead.hasName);
}

function compareBestLead(a: LeadVM, b: LeadVM): number {
  const score = completenessScore(b) - completenessScore(a);
  if (score !== 0) return score;

  if (a.scanBatchId && b.scanBatchId && a.scanBatchId === b.scanBatchId) {
    const order = (a.scanOrder ?? Number.MAX_SAFE_INTEGER) - (b.scanOrder ?? Number.MAX_SAFE_INTEGER);
    if (order !== 0) return order;
  }

  return a.createdAt.localeCompare(b.createdAt);
}

function groupsBy(
  leads: LeadVM[],
  keyFn: (lead: LeadVM) => string,
  labelFn: (key: string) => string,
  type: DuplicateGroup["type"],
): DuplicateGroup[] {
  const map = new Map<string, LeadVM[]>();
  for (const lead of leads) {
    const key = keyFn(lead);
    if (!key) continue;
    map.set(key, [...(map.get(key) ?? []), lead]);
  }

  return [...map.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => {
      const ordered = group.slice().sort(compareBestLead);
      return {
        key,
        label: labelFn(key),
        type,
        leads: group,
        suggestedKeepId: ordered[0]?.id ?? group[0].id,
      };
    });
}

export function duplicateGroups(leads: LeadVM[], tab: DuplicateTab): DuplicateGroup[] {
  const phoneGroups = groupsBy(leads, phoneKey, (key) => `Same number ${key}`, "same-number");
  const plateGroups = groupsBy(leads, plateKey, (key) => `Same plate ${key}`, "same-plate");

  if (tab === "same-number") return phoneGroups;
  if (tab === "same-plate") return plateGroups;
  if (tab === "duplicates") return [...phoneGroups, ...plateGroups];
  return [];
}

export function duplicateTabCounts(leads: LeadVM[]) {
  const reviews = duplicateReviewMap(leads);
  let sameNumber = 0;
  let samePlate = 0;

  for (const review of reviews.values()) {
    if (review.label === "Exact duplicate" || review.label === "Same number") sameNumber++;
    if (review.label === "Same plate") samePlate++;
  }

  return {
    all: leads.length,
    duplicates: reviews.size,
    sameNumber,
    samePlate,
  };
}

export function filterByDuplicateTab(leads: LeadVM[], tab: DuplicateTab): LeadVM[] {
  if (tab === "all") return leads;

  const reviews = duplicateReviewMap(leads);
  return leads.filter((lead) => {
    const review = reviews.get(lead.id);
    if (!review) return false;
    if (tab === "duplicates") return true;
    if (tab === "same-number") return review.label === "Same number" || review.label === "Exact duplicate";
    return review.label === "Same plate";
  });
}

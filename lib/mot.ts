import type { MotClassId } from "./types";
import type { MotState } from "./dvla";

export type MotClass = {
  id: MotClassId;
  label: string;
  vehicles: string;
  maxFee: number;
  /** lucide icon id, mapped to a component in the UI */
  icon: "bike" | "trike" | "car" | "bus" | "van";
};

/** DVSA classes with statutory maximum test fees (GBP). */
export const MOT_CLASSES: MotClass[] = [
  {
    id: "class-1",
    label: "Class 1",
    vehicles: "Motorcycles up to 200cc",
    maxFee: 29.65,
    icon: "bike",
  },
  {
    id: "class-2",
    label: "Class 2",
    vehicles: "Motorcycles over 200cc",
    maxFee: 29.65,
    icon: "bike",
  },
  {
    id: "class-3",
    label: "Class 3",
    vehicles: "3-wheeled vehicles up to 450kg",
    maxFee: 37.8,
    icon: "trike",
  },
  {
    id: "class-4",
    label: "Class 4",
    vehicles: "Cars & vans up to 3,000kg",
    maxFee: 54.85,
    icon: "car",
  },
  {
    id: "class-5",
    label: "Class 5",
    vehicles: "Passenger vehicles, 13+ seats",
    maxFee: 59.55,
    icon: "bus",
  },
  {
    id: "class-7",
    label: "Class 7",
    vehicles: "Vans 3,000–3,500kg",
    maxFee: 58.6,
    icon: "van",
  },
];

/** Same thresholds as the DVLA derivation: ≤14d due now, ≤42d due soon. */
export function motStateFromDate(
  dueDate: string | null,
  today = new Date(),
): { state: MotState; days: number | null } {
  if (!dueDate) return { state: "no_details", days: null };
  const exp = new Date(dueDate + "T00:00:00Z");
  if (Number.isNaN(exp.getTime())) return { state: "no_details", days: null };
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = Math.round((exp.getTime() - t) / 86_400_000);
  if (days < 0) return { state: "overdue", days };
  if (days <= 14) return { state: "due_now", days };
  if (days <= 42) return { state: "due_soon", days };
  return { state: "current", days };
}

export const MOT_STATE_META: Record<
  MotState,
  { label: string; chip: string; priority: number }
> = {
  overdue: { label: "Overdue", chip: "bg-rose-100 text-rose-700", priority: 0 },
  due_now: { label: "Due now", chip: "bg-orange-100 text-orange-700", priority: 1 },
  due_soon: { label: "Due soon", chip: "bg-lime text-pine-deep", priority: 2 },
  no_details: { label: "No record", chip: "bg-mist text-ink/50", priority: 3 },
  current: { label: "Up to date", chip: "bg-mist text-ink/60", priority: 4 },
};

export function dueLabel(days: number | null): string {
  if (days === null) return "-";
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "due today";
  if (days < 14) return `in ${days}d`;
  return `in ${Math.round(days / 7)}w`;
}

import { motStateFromDate } from "@/lib/mot";

/* ── raw db row from /api/leads ── */
export type DbLead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string;
  registration: string | null;
  vehicle: string | null;
  mot_due_date: string | null;
  mot_due_source: string;
  status: string;
  notes?: string | null;
  created_at: string;
};

export type LeadState = "overdue" | "soon" | "booked" | "new" | "ok";

export type LeadVM = {
  id: string;
  name: string;
  hasName: boolean;
  plate: string;
  car: string;
  due: string;
  state: LeadState;
  badge: string;
  phone: string;
  contacted: boolean;
  motDueDate: string | null;
  days: number | null;
  createdAt: string;
  scanBatchId: string | null;
  scanOrder: number | null;
};

export type BookingVM = {
  id: string;
  date: string; // YYYY-MM-DD
  time: string;
  name: string;
  plate: string;
  car: string;
  phone: string;
  leadId: string | null;
};

/** "AB12CDE" → "AB12 CDE" for the plate chip. */
export function formatPlate(reg: string | null): string {
  const r = (reg ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!r) return "";
  if (r.length === 7) return r.slice(0, 4) + " " + r.slice(4);
  return r;
}

function shortDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function toLeadVM(l: DbLead): LeadVM {
  const name = [l.first_name, l.last_name].filter(Boolean).join(" ");
  const { state: motState, days } = motStateFromDate(l.mot_due_date);
  const contacted = ["contacted", "replied", "booked"].includes(l.status);
  const scanMeta = parseScanMeta(l.notes ?? null);

  let state: LeadState;
  let badge: string;
  let due: string;

  if (l.status === "booked") {
    state = "booked";
    badge = "Booked";
    due = l.mot_due_date ? "due " + shortDate(l.mot_due_date) : "booked in";
  } else if (motState === "overdue") {
    state = "overdue";
    badge = "Overdue";
    due = `expired ${Math.abs(days ?? 0)} day${Math.abs(days ?? 0) === 1 ? "" : "s"}`;
  } else if (motState === "due_now" || motState === "due_soon") {
    state = "soon";
    badge = `Due ${days}d`;
    due = "due " + shortDate(l.mot_due_date!);
  } else if (motState === "no_details") {
    state = "new";
    badge = "New";
    due = "checking with DVLA";
  } else {
    state = "ok";
    badge = days !== null ? `Due ${days}d` : "Up to date";
    due = l.mot_due_date ? "due " + shortDate(l.mot_due_date) : "";
  }

  return {
    id: l.id,
    name: name || "No name",
    hasName: Boolean(name),
    plate: formatPlate(l.registration),
    car: l.vehicle ?? "",
    due,
    state,
    badge,
    phone: l.phone ?? "",
    contacted,
    motDueDate: l.mot_due_date,
    days,
    createdAt: l.created_at,
    scanBatchId: scanMeta.scanBatchId,
    scanOrder: scanMeta.scanOrder,
  };
}

function parseScanMeta(notes: string | null): { scanBatchId: string | null; scanOrder: number | null } {
  if (!notes) return { scanBatchId: null, scanOrder: null };
  try {
    const parsed = JSON.parse(notes) as { scanBatchId?: unknown; scanOrder?: unknown };
    const scanBatchId = typeof parsed.scanBatchId === "string" ? parsed.scanBatchId : null;
    const scanOrder = typeof parsed.scanOrder === "number" && Number.isFinite(parsed.scanOrder) ? parsed.scanOrder : null;
    return { scanBatchId, scanOrder };
  } catch {
    return { scanBatchId: null, scanOrder: null };
  }
}

export function isPending(l: DbLead): boolean {
  return l.status === "queued";
}

export function isLive(l: DbLead): boolean {
  return l.status !== "queued" && l.status !== "invalid";
}

export function comparePendingLeadOrder(a: LeadVM, b: LeadVM): number {
  if (a.scanBatchId && b.scanBatchId && a.scanBatchId === b.scanBatchId) {
    const aOrder = a.scanOrder ?? Number.MAX_SAFE_INTEGER;
    const bOrder = b.scanOrder ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
  }

  const created = a.createdAt.localeCompare(b.createdAt);
  if (created !== 0) return created;

  return (a.scanOrder ?? Number.MAX_SAFE_INTEGER) - (b.scanOrder ?? Number.MAX_SAFE_INTEGER);
}

type RawBooking = {
  id: string;
  slot_start: string;
  slot_end: string | null;
  status: string;
  leads: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    phone: string;
    registration: string | null;
    vehicle: string | null;
  } | null;
};

export function toBookingVM(b: RawBooking): BookingVM {
  const d = new Date(b.slot_start);
  const name = [b.leads?.first_name, b.leads?.last_name].filter(Boolean).join(" ") || "Customer";
  return {
    id: b.id,
    date: b.slot_start.slice(0, 10),
    time: d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" }),
    name,
    plate: formatPlate(b.leads?.registration ?? null),
    car: b.leads?.vehicle ?? "",
    phone: b.leads?.phone ?? "",
    leadId: b.leads?.id ?? null,
  };
}

export const WINDOW_OPTIONS = ["14d", "21d", "30d", "42d", "60d"];

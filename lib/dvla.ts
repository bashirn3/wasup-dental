export type MotState = "overdue" | "due_now" | "due_soon" | "current" | "no_details";

export type DvlaResult = {
  registrationNumber: string;
  motStatus?: string;
  motExpiryDate?: string;
  taxStatus?: string;
  make?: string;
  colour?: string;
  yearOfManufacture?: number;
  fuelType?: string;
};

export type MotDerivation = {
  motStatus: string | null;
  motExpiryDate: string | null;
  daysUntilDue: number | null;
  motState: MotState;
  make: string | null;
  colour: string | null;
};

/** Hard ceiling for a single DVLA call so a slow/hung upstream never blocks the UI. */
const DVLA_TIMEOUT_MS = 12_000;

/** Call the DVLA Vehicle Enquiry Service for one plate. */
export async function lookupVehicle(plate: string): Promise<DvlaResult> {
  const registrationNumber = plate.replace(/\s+/g, "").toUpperCase();
  const url = process.env.DVLA_VES_URL;
  const key = process.env.DVLA_VES_API_KEY;
  if (!url || !key) throw new Error("dvla_not_configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DVLA_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "x-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ registrationNumber }),
      signal: controller.signal,
    });
  } catch (err) {
    // AbortError (our timeout) or a network failure — surface a typed error
    // so the route can return a fast, clear response instead of hanging.
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("dvla_timeout");
    }
    throw new Error("dvla_unreachable");
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) {
    return { registrationNumber, motStatus: "No details held by DVLA" };
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DVLA VES failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return (await res.json()) as DvlaResult;
}

/** Derive the reactivation state machine from a VES response. */
export function deriveMotState(v: DvlaResult, today = new Date()): MotDerivation {
  const status = v.motStatus ?? null;
  const make = v.make ?? null;
  const colour = v.colour ?? null;

  if (!status || /no details/i.test(status)) {
    return {
      motStatus: status,
      motExpiryDate: null,
      daysUntilDue: null,
      motState: "no_details",
      make,
      colour,
    };
  }

  const expiry = v.motExpiryDate ?? null;
  let days: number | null = null;
  if (expiry) {
    const exp = new Date(expiry + "T00:00:00Z");
    const t = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    );
    days = Math.round((exp.getTime() - t.getTime()) / 86_400_000);
  }

  let state: MotState;
  if (/not valid/i.test(status) || (days !== null && days < 0)) state = "overdue";
  else if (days === null) state = "current";
  else if (days <= 14) state = "due_now";
  else if (days <= 42) state = "due_soon";
  else state = "current";

  return {
    motStatus: status,
    motExpiryDate: expiry,
    daysUntilDue: days,
    motState: state,
    make,
    colour,
  };
}

import { NextRequest, NextResponse } from "next/server";
import { deriveMotState, lookupVehicle } from "@/lib/dvla";

export async function GET(req: NextRequest) {
  const plate = req.nextUrl.searchParams.get("plate");
  if (!plate || plate.replace(/[^A-Za-z0-9]/g, "").length < 2) {
    return NextResponse.json({ error: "invalid_plate" }, { status: 400 });
  }

  try {
    const vehicle = await lookupVehicle(plate);
    const mot = deriveMotState(vehicle);
    return NextResponse.json({
      registration: vehicle.registrationNumber,
      ...mot,
      taxStatus: vehicle.taxStatus ?? null,
      fuelType: vehicle.fuelType ?? null,
      year: vehicle.yearOfManufacture ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "lookup_failed";
    if (msg === "dvla_not_configured") {
      return NextResponse.json({ error: msg }, { status: 503 });
    }
    if (msg === "dvla_timeout" || msg === "dvla_unreachable") {
      // Fast, explicit failure so the client never spins forever.
      return NextResponse.json({ error: msg }, { status: 504 });
    }
    console.error("vehicle lookup failed:", msg);
    return NextResponse.json({ error: "lookup_failed" }, { status: 502 });
  }
}

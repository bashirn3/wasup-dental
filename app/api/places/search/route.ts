import { NextRequest, NextResponse } from "next/server";
import { MOCK_PLACES } from "@/lib/mock-places";
import type { GaragePlace } from "@/lib/types";

const KEY = process.env.GOOGLE_MAPS_API_KEY;

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.internationalPhoneNumber",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.websiteUri",
  "places.regularOpeningHours.weekdayDescriptions",
  "places.primaryTypeDisplayName",
].join(",");

type GooglePlace = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  internationalPhoneNumber?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  websiteUri?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  primaryTypeDisplayName?: { text?: string };
};

export async function POST(req: NextRequest) {
  const { query } = (await req.json()) as { query?: string };
  const q = (query ?? "").trim();
  if (q.length < 2) return NextResponse.json({ places: [] });

  if (!KEY) {
    const lower = q.toLowerCase();
    const hits = MOCK_PLACES.filter((p) =>
      p.name.toLowerCase().includes(lower),
    );
    return NextResponse.json({
      places: hits.length > 0 ? hits : MOCK_PLACES,
      mock: true,
    });
  }

  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": KEY,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: q,
      regionCode: "GB",
      pageSize: 5,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error("Places searchText failed:", res.status, detail);
    return NextResponse.json(
      { error: "places_search_failed" },
      { status: 502 },
    );
  }

  const data = (await res.json()) as { places?: GooglePlace[] };
  const places: GaragePlace[] = (data.places ?? [])
    .filter((p) => p.location)
    .map((p) => ({
      id: p.id,
      name: p.displayName?.text ?? "Unknown",
      address: p.formattedAddress ?? "",
      phone: p.internationalPhoneNumber ?? null,
      lat: p.location!.latitude,
      lng: p.location!.longitude,
      rating: p.rating ?? null,
      ratingCount: p.userRatingCount ?? null,
      website: p.websiteUri ?? null,
      openingHours: p.regularOpeningHours?.weekdayDescriptions ?? [],
      category: p.primaryTypeDisplayName?.text ?? null,
    }));

  return NextResponse.json({ places });
}

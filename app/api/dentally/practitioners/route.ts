import { NextRequest, NextResponse } from "next/server";
import { dentallyTokenForPracticeName } from "@/lib/admin-attribution-funnel";
import { resolvePracticeMembership } from "@/lib/dental-auth";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type DentallyPractitioner = {
  id?: number | string;
  active?: boolean;
  user?: { first_name?: string; last_name?: string; email?: string } | null;
  first_name?: string;
  last_name?: string;
  name?: string;
};

/**
 * The clinicians a practice can assign treatments to.
 *
 * Read straight from Dentally rather than stored, because a practice hiring or
 * losing a clinician is Dentally's business and a copy here would go stale
 * without anyone noticing. Only id and name are returned: the picker needs
 * nothing else, and the rest of a practitioner record is staff personal data.
 */
export async function GET(req: NextRequest) {
  const membership = await resolvePracticeMembership(req.nextUrl.searchParams.get("practiceId"));
  if (!membership?.practiceId) {
    return NextResponse.json({ error: "practice_not_found" }, { status: 404 });
  }

  const supabase = supabaseAdmin();
  if (!supabase) return NextResponse.json({ practitioners: [] });

  const { data: practice } = await supabase
    .from("practices")
    .select("name")
    .eq("id", membership.practiceId)
    .maybeSingle();

  const token = practice?.name ? dentallyTokenForPracticeName(practice.name) : null;
  // An empty list rather than an error: the panel says clinicians are
  // unavailable, which is what a practice without a Dentally token means.
  if (!token) return NextResponse.json({ practitioners: [], reason: "no_token" });

  try {
    const res = await fetch("https://api.dentally.co/v1/practitioners?per_page=200", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ practitioners: [], reason: `dentally_${res.status}` });
    }

    const payload = (await res.json()) as { practitioners?: DentallyPractitioner[] };
    const practitioners = (payload.practitioners ?? [])
      .filter((row) => row.active !== false)
      .map((row) => ({ id: String(row.id ?? ""), name: nameOf(row) }))
      .filter((row) => row.id && row.name)
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ practitioners });
  } catch {
    return NextResponse.json({ practitioners: [], reason: "dentally_unreachable" });
  }
}

function nameOf(row: DentallyPractitioner): string {
  const fromUser = [row.user?.first_name, row.user?.last_name].filter(Boolean).join(" ").trim();
  if (fromUser) return fromUser;
  const direct = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  return direct || (row.name ?? "").trim();
}

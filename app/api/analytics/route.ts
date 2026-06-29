import { NextRequest, NextResponse } from "next/server";
import { clerkEnabled } from "@/lib/auth";
import { resolvePracticeMembership } from "@/lib/dental-auth";
import { getDentalAnalytics } from "@/lib/dental-dashboard-data";

export const dynamic = "force-dynamic";

/**
 * Date-range analytics for the dashboard.
 * GET /api/analytics?practiceId=<uuid>&range=today|last_7_days|last_30_days|last_3_months|all_time
 */
export async function GET(req: NextRequest) {
  const membership = await resolvePracticeMembership(req.nextUrl.searchParams.get("practiceId"));
  if (clerkEnabled() && !membership?.practiceId) {
    return NextResponse.json({ error: "practice_access_denied" }, { status: 403 });
  }

  const result = await getDentalAnalytics(
    membership?.practiceId ?? null,
    req.nextUrl.searchParams.get("range"),
  );

  return NextResponse.json({ ok: true, ...result });
}

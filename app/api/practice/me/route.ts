import { NextRequest, NextResponse } from "next/server";
import { resolvePracticeMembership } from "@/lib/dental-auth";
import { getDentalDashboardData } from "@/lib/dental-dashboard-data";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const membership = await resolvePracticeMembership(req.nextUrl.searchParams.get("practiceId"));
  const data = await getDentalDashboardData(membership?.practiceId ?? null);

  return NextResponse.json({
    ok: true,
    role: membership?.role ?? "admin",
    practice: data.practice,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { clerkEnabled } from "@/lib/auth";
import { getSignedInEmail, listAccessibleWorkspaces, resolvePracticeMembership } from "@/lib/dental-auth";
import { getDentalDashboardData } from "@/lib/dental-dashboard-data";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const membership = await resolvePracticeMembership(req.nextUrl.searchParams.get("practiceId"));
  if (clerkEnabled() && !membership?.practiceId) {
    return NextResponse.json(
      { error: "practice_access_denied", signedInEmail: await getSignedInEmail() },
      { status: 403 },
    );
  }

  const data = await getDentalDashboardData(membership?.practiceId ?? null, {
    limit: Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "", 10),
    offset: Number.parseInt(req.nextUrl.searchParams.get("offset") ?? "", 10),
    q: req.nextUrl.searchParams.get("q"),
    status: req.nextUrl.searchParams.get("status"),
    box: req.nextUrl.searchParams.get("box"),
    stage: req.nextUrl.searchParams.get("stage"),
  });
  const workspaces = await listAccessibleWorkspaces();

  return NextResponse.json({
    ok: true,
    role: membership?.role ?? "admin",
    workspaces,
    ...data,
  });
}

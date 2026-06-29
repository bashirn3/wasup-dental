import { NextRequest, NextResponse } from "next/server";
import { clerkEnabled } from "@/lib/auth";
import { listAccessibleWorkspaces, resolvePracticeMembership } from "@/lib/dental-auth";
import { getDentalDashboardData } from "@/lib/dental-dashboard-data";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const membership = await resolvePracticeMembership(req.nextUrl.searchParams.get("practiceId"));
  if (clerkEnabled() && !membership?.practiceId) {
    return NextResponse.json({ error: "practice_access_denied" }, { status: 403 });
  }

  const data = await getDentalDashboardData(membership?.practiceId ?? null);
  const workspaces = await listAccessibleWorkspaces();

  return NextResponse.json({
    ok: true,
    role: membership?.role ?? "admin",
    workspaces,
    ...data,
  });
}

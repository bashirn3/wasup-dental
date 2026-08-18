import { NextRequest, NextResponse } from "next/server";
import { requireInternalAdmin } from "@/lib/dental-auth";
import { getFunnelLeadNotes, type PracticeKey } from "@/lib/admin-attribution-funnel";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const admin = await requireInternalAdmin();
  if (!admin) return NextResponse.json({ error: "admin_access_denied" }, { status: 403 });

  const practices: PracticeKey[] = ["regent", "nuyu", "dental_aesthetica"];
  const practice = req.nextUrl.searchParams.get("practice") as PracticeKey | null;
  const leadId = req.nextUrl.searchParams.get("leadId");
  if (!practice || !practices.includes(practice) || !leadId) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const notes = await getFunnelLeadNotes(practice, leadId);
  return NextResponse.json({ ok: true, notes });
}

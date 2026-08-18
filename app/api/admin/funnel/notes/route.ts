import { NextRequest, NextResponse } from "next/server";
import { resolveFunnelAccess } from "@/lib/dental-auth";
import {
  funnelKeysForPracticeNames,
  getFunnelLeadNotes,
  type PracticeKey,
} from "@/lib/admin-attribution-funnel";

export const dynamic = "force-dynamic";

const PRACTICE_KEYS: PracticeKey[] = ["regent", "nuyu", "dental_aesthetica"];

export async function GET(req: NextRequest) {
  const access = await resolveFunnelAccess();
  if (!access) return NextResponse.json({ error: "admin_access_denied" }, { status: 403 });

  const practice = req.nextUrl.searchParams.get("practice") as PracticeKey | null;
  const leadId = req.nextUrl.searchParams.get("leadId");
  if (!practice || !PRACTICE_KEYS.includes(practice) || !leadId) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  // A scoped reader could otherwise ask for another practice's conversation by
  // changing the query string.
  if (access.scope === "practices" && !funnelKeysForPracticeNames(access.practiceNames).has(practice)) {
    return NextResponse.json({ error: "admin_access_denied" }, { status: 403 });
  }

  const notes = await getFunnelLeadNotes(practice, leadId);
  return NextResponse.json({ ok: true, notes });
}

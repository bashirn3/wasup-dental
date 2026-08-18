import { NextRequest, NextResponse } from "next/server";
import { requireInternalAdmin } from "@/lib/dental-auth";
import { getAdminAttributionFunnel } from "@/lib/admin-attribution-funnel";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Internal only, unlike reading the funnel: building a snapshot calls Dentally
  // for every practice, so it is not a practice contact's to trigger.
  const admin = await requireInternalAdmin();
  if (!admin) return NextResponse.json({ error: "admin_access_denied" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { dentallyLimit?: number };
  const dentallyLimit =
    typeof body.dentallyLimit === "number" && Number.isFinite(body.dentallyLimit) && body.dentallyLimit > 0
      ? body.dentallyLimit
      : undefined;

  const result = await getAdminAttributionFunnel({
    refresh: true,
    enrichDentally: true,
    dentallyLimit,
  });

  return NextResponse.json({ ok: true, ...result });
}

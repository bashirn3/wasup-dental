import { NextRequest, NextResponse } from "next/server";
import { resolveFunnelAccess } from "@/lib/dental-auth";
import {
  funnelToCsv,
  getAdminAttributionFunnel,
  scopeFunnelToPractices,
} from "@/lib/admin-attribution-funnel";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const access = await resolveFunnelAccess();
  if (!access) return NextResponse.json({ error: "admin_access_denied" }, { status: 403 });

  const full = await getAdminAttributionFunnel();
  // One snapshot covers every practice, so a practice contact's view is cut here
  // rather than built separately. The CSV is cut with it.
  const result =
    access.scope === "all" ? full : scopeFunnelToPractices(full, access.practiceNames);

  if (req.nextUrl.searchParams.get("format") === "csv") {
    return new NextResponse(funnelToCsv(result), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="dental-attribution-funnel-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`,
      },
    });
  }

  return NextResponse.json({ ok: true, ...result });
}

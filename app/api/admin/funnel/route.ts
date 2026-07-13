import { NextRequest, NextResponse } from "next/server";
import { requireInternalAdmin } from "@/lib/dental-auth";
import { funnelToCsv, getAdminAttributionFunnel } from "@/lib/admin-attribution-funnel";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const admin = await requireInternalAdmin();
  if (!admin) return NextResponse.json({ error: "admin_access_denied" }, { status: 403 });

  const result = await getAdminAttributionFunnel();

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

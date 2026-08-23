import { NextRequest, NextResponse } from "next/server";
import { resolveFunnelAccess } from "@/lib/dental-auth";
import type { PracticeKey } from "@/lib/admin-attribution-funnel";
import {
  funnelKeysForPracticeNames,
  funnelToCsv,
  getAdminAttributionFunnel,
  isFunnelPracticeKey,
  scopeFunnelToKeys,
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
    const asked = req.nextUrl.searchParams.get("practice");
    let wanted: PracticeKey | null = null;
    if (asked) {
      if (!isFunnelPracticeKey(asked)) {
        return NextResponse.json({ error: "unknown_practice" }, { status: 400 });
      }
      wanted = asked;
    }

    // Checked against what this reader is allowed rather than what the snapshot
    // returned, so a practice whose build failed exports empty instead of
    // reading as forbidden.
    const allowed =
      access.scope === "all" ? null : funnelKeysForPracticeNames(access.practiceNames);
    if (wanted && allowed && !allowed.has(wanted)) {
      return NextResponse.json({ error: "practice_access_denied" }, { status: 403 });
    }

    const scoped = wanted ? scopeFunnelToKeys(result, new Set([wanted])) : result;
    const name = ["dental-attribution-funnel", wanted, new Date().toISOString().slice(0, 10)]
      .filter(Boolean)
      .join("-");

    return new NextResponse(funnelToCsv(scoped), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${name}.csv"`,
      },
    });
  }

  return NextResponse.json({ ok: true, ...result });
}

import { NextRequest, NextResponse } from "next/server";
import { resolvePracticeMembership } from "@/lib/dental-auth";
import { fetchLeadHistory } from "@/lib/leadflo-history";
import { loadLeadfloFeederAccess } from "@/lib/leadflo-mirror";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * One patient's history: staff notes, stage changes and Leadflo activity.
 *
 * Read live from the feeder rather than mirrored, because a note written this
 * morning should appear when the panel opens rather than at the next sync, and
 * because it is read on demand for a single patient instead of for all of them.
 *
 * The feeder key stays on the server. The lead is loaded scoped to the caller's
 * practice first, so a lead id from another practice reads as not found.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const { leadId } = await params;
  const membership = await resolvePracticeMembership(req.nextUrl.searchParams.get("practiceId"));
  if (!membership?.practiceId) {
    return NextResponse.json({ error: "practice_access_denied" }, { status: 403 });
  }

  const supabase = supabaseAdmin();
  if (!supabase) return NextResponse.json({ entries: [] });

  const { data: lead } = await supabase
    .from("leads")
    .select("id, external_id, source_system")
    .eq("id", leadId)
    .eq("practice_id", membership.practiceId)
    .maybeSingle();

  if (!lead) return NextResponse.json({ error: "lead_not_found" }, { status: 404 });

  // Only Leadflo keeps a timeline we can read. A Boxly lead gets an empty panel
  // that says so, rather than an error that looks like a fault.
  if (lead.source_system !== "leadflo" || !lead.external_id) {
    return NextResponse.json({ entries: [], supported: false });
  }

  try {
    const access = await loadLeadfloFeederAccess(membership.practiceId);
    const entries = await fetchLeadHistory({
      baseUrl: access.baseUrl,
      apiKey: access.apiKey,
      externalId: lead.external_id,
    });
    return NextResponse.json({ entries, supported: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "history_read_failed",
        entries: [],
        supported: true,
      },
      { status: 502 },
    );
  }
}

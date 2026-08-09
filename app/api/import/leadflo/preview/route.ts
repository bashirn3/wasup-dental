import { NextRequest, NextResponse } from "next/server";
import { resolvePracticeMembership } from "@/lib/dental-auth";
import { previewLeadfloPractice } from "@/lib/leadflo-mirror";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function clampLimit(value: string | null) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 5000) : 2000;
}

export async function GET(req: NextRequest) {
  const membership = await resolvePracticeMembership(req.nextUrl.searchParams.get("practiceId"));
  if (!membership?.practiceId || membership.role !== "admin") {
    return NextResponse.json({ error: "admin_required" }, { status: 403 });
  }

  try {
    const preview = await previewLeadfloPractice(membership.practiceId, {
      integrationId: req.nextUrl.searchParams.get("integrationId"),
      limit: clampLimit(req.nextUrl.searchParams.get("limit")),
    });

    return NextResponse.json({
      ok: true,
      mode: "preview_read_only",
      preview,
      sideEffects: {
        liveMessagesSent: false,
        bookingsCreated: false,
        paymentsCreated: false,
        crmUpdated: false,
        workflowsTriggered: false,
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: "leadflo_preview_failed", detail }, { status: 502 });
  }
}

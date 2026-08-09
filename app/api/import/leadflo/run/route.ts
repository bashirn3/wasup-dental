import { NextRequest, NextResponse } from "next/server";
import { resolvePracticeMembership } from "@/lib/dental-auth";
import { mirrorLeadfloPractice, previewLeadfloPractice } from "@/lib/leadflo-mirror";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function readInternalToken(req: NextRequest) {
  const bearer = req.headers.get("authorization");
  if (bearer?.startsWith("Bearer ")) return bearer.slice("Bearer ".length).trim();
  return req.headers.get("x-api-key")?.trim() ?? "";
}

function isInternalRequest(req: NextRequest) {
  const expected = process.env.CRON_SECRET || process.env.AGENT_CONFIG_API_KEY;
  return Boolean(expected && readInternalToken(req) === expected);
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    practiceId?: string | null;
    dryRun?: boolean;
    integrationId?: string | null;
    limit?: number;
  };

  const internal = isInternalRequest(req);
  const membership =
    internal && body.practiceId
      ? { practiceId: body.practiceId, role: "admin" as const }
      : await resolvePracticeMembership(body.practiceId ?? null);

  if (!membership?.practiceId || (membership.role !== "admin" && !internal)) {
    return NextResponse.json({ error: "admin_required" }, { status: 403 });
  }

  try {
    if (body.dryRun) {
      const preview = await previewLeadfloPractice(membership.practiceId, {
        integrationId: body.integrationId ?? null,
        limit: body.limit,
      });
      return NextResponse.json({
        ok: true,
        mode: "preview_only",
        practiceId: membership.practiceId,
        preview,
        sideEffects: {
          liveMessagesSent: false,
          bookingsCreated: false,
          paymentsCreated: false,
          crmUpdated: false,
          workflowsTriggered: false,
        },
      });
    }

    const result = await mirrorLeadfloPractice(membership.practiceId, {
      integrationId: body.integrationId ?? null,
      limit: body.limit,
    });

    return NextResponse.json({
      ok: true,
      mode: "cache_sync_only",
      practiceId: membership.practiceId,
      result,
      sideEffects: {
        liveMessagesSent: false,
        bookingsCreated: false,
        paymentsCreated: false,
        // The mirror only reads Leadflo through the feeder; the CRM is untouched.
        crmUpdated: false,
        workflowsTriggered: false,
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: "leadflo_sync_failed", detail }, { status: 502 });
  }
}

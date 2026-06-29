import { NextRequest, NextResponse } from "next/server";
import { resolvePracticeMembership } from "@/lib/dental-auth";
import { mirrorBoxlyPractice } from "@/lib/boxly-mirror";

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
    includeConversations?: boolean;
  };
  const internal = isInternalRequest(req);
  const membership =
    internal && body.practiceId
      ? { practiceId: body.practiceId, role: "admin" as const }
      : await resolvePracticeMembership(body.practiceId ?? null);

  if (!membership?.practiceId || (membership.role !== "admin" && !internal)) {
    return NextResponse.json({ error: "admin_required" }, { status: 403 });
  }

  if (body.dryRun) {
    return NextResponse.json({
      ok: true,
      mode: "preview_only",
      practiceId: membership.practiceId,
      sideEffects: {
        liveMessagesSent: false,
        bookingsCreated: false,
        paymentsCreated: false,
        crmUpdated: false,
        workflowsTriggered: false,
      },
    });
  }

  const result = await mirrorBoxlyPractice(membership.practiceId, {
    integrationId: body.integrationId ?? null,
    limit: body.limit,
    includeConversations: body.includeConversations ?? true,
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
      crmUpdated: false,
      workflowsTriggered: false,
    },
  });
}

import { NextRequest, NextResponse } from "next/server";
import { getAdminAttributionFunnel } from "@/lib/admin-attribution-funnel";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * How long this run may spend asking Dentally about patients.
 *
 * Well inside maxDuration on purpose. Rebuilding engagement for all three
 * practices takes a few seconds before any of this starts, and saving the result
 * has to happen after it: a run that used its whole allowance and then got killed
 * would throw away everything it had just learned.
 */
const DENTALLY_BUDGET_MS = 200_000;

function readBearer(req: NextRequest) {
  const bearer = req.headers.get("authorization");
  if (bearer?.startsWith("Bearer ")) return bearer.slice("Bearer ".length).trim();
  return req.headers.get("x-api-key")?.trim() ?? "";
}

function isAuthorized(req: NextRequest) {
  const expected = process.env.CRON_SECRET || process.env.AGENT_CONFIG_API_KEY;
  if (expected && readBearer(req) === expected) return true;
  return req.headers.get("x-vercel-cron") === "1";
}

/**
 * The nightly attribution snapshot.
 *
 * A GET rather than a POST because that is what Vercel's scheduler sends, and
 * secret-gated rather than session-gated because a scheduler has no session.
 * /api/admin/funnel/snapshot, the POST an admin fires by hand, is the same job
 * behind a Clerk session.
 *
 * It lives here rather than beside that POST because proxy.ts protects
 * /api/admin with Clerk, and Clerk answers an unauthenticated API request with a
 * 404 before the handler runs. Scheduled work therefore has to sit outside that
 * namespace and carry its own secret, as /api/engine/outbound and the
 * /api/import crons already do.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const result = await getAdminAttributionFunnel({
      refresh: true,
      enrichDentally: true,
      budgetMs: DENTALLY_BUDGET_MS,
    });

    return NextResponse.json({
      ok: true,
      tookMs: Date.now() - startedAt,
      generatedAt: result.generatedAt,
      dentally: result.dentally,
      warnings: result.warnings,
      practices: result.practices.map((practice) => ({
        practice: practice.key,
        rows: practice.rows.length,
        reached: practice.leadsReached,
        replied: practice.patientsReplied,
        booked: practice.consultsBooked,
        paidTreatment: practice.paidTreatmentCount,
      })),
      sideEffects: {
        liveMessagesSent: false,
        bookingsCreated: false,
        paymentsCreated: false,
        crmUpdated: false,
        workflowsTriggered: false,
      },
    });
  } catch (error) {
    // Reported rather than thrown so a failed night is visible in the cron log
    // with a reason, instead of an opaque 500.
    return NextResponse.json(
      {
        ok: false,
        tookMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

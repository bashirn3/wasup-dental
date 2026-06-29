import { NextRequest, NextResponse } from "next/server";
import { mirrorBoxlyPractice } from "@/lib/boxly-mirror";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
// Both practices (+ conversation dedup) sync in one cron invocation; give it room.
export const maxDuration = 300;

type IntegrationRow = {
  id: string;
  practice_id: string;
  source_system: string;
  display_name: string;
};

type SupabaseResult<T> = {
  data: T | null;
  error: { code?: string; message: string } | null;
};

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

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = supabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });

  const { data, error } = (await supabase
    .from("integrations")
    .select("id, practice_id, source_system, display_name")
    .eq("source_system", "boxly")
    .in("status", ["connected", "error"])) as SupabaseResult<IntegrationRow[]>;

  if (error) {
    return NextResponse.json({ error: "integration_lookup_failed", detail: error.code }, { status: 500 });
  }

  const results = [];
  for (const integration of data ?? []) {
    try {
      const result = await mirrorBoxlyPractice(integration.practice_id, {
        integrationId: integration.id,
        // Runs every minute: sync the newest enquiries (by became_lead_at) so each
        // run stays fast and never overlaps. New leads always sort to the top of
        // this window; deeper backfills use scripts/sync-boxly.mjs.
        limit: 300,
        includeConversations: true,
      });
      results.push({ ok: true, integrationId: integration.id, result });
    } catch (syncError) {
      results.push({
        ok: false,
        integrationId: integration.id,
        practiceId: integration.practice_id,
        error: syncError instanceof Error ? syncError.message : String(syncError),
      });
    }
  }

  return NextResponse.json(
    {
      ok: results.every((result) => result.ok),
      mode: "cache_sync_only",
      synced: results.length,
      results,
      sideEffects: {
        liveMessagesSent: false,
        bookingsCreated: false,
        paymentsCreated: false,
        crmUpdated: false,
        workflowsTriggered: false,
      },
    },
    { status: results.some((result) => !result.ok) ? 207 : 200 },
  );
}

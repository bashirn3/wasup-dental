import { NextRequest, NextResponse } from "next/server";
import { mirrorLeadfloPractice } from "@/lib/leadflo-mirror";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type IntegrationRow = {
  id: string;
  practice_id: string;
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

  // A freshly seeded integration is 'draft' and is skipped here on purpose: the
  // first sync is run deliberately by hand, and only once it succeeds (status
  // becomes 'connected') does the schedule start picking the practice up.
  const { data, error } = (await supabase
    .from("integrations")
    .select("id, practice_id, display_name")
    .eq("source_system", "leadflo")
    .in("status", ["connected", "error"])) as SupabaseResult<IntegrationRow[]>;

  if (error) {
    return NextResponse.json(
      { error: "integration_lookup_failed", detail: error.code },
      { status: 500 },
    );
  }

  const results = [];
  for (const integration of data ?? []) {
    try {
      const result = await mirrorLeadfloPractice(integration.practice_id, {
        integrationId: integration.id,
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

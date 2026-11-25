import { NextRequest, NextResponse } from "next/server";
import { syncAiBookings } from "@/lib/ai-bookings";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type IntegrationRow = {
  id: string;
  practice_id: string;
  display_name: string;
  settings: Record<string, unknown> | null;
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

  // Every lead source whose agent keeps n8n chat memory names its session prefix.
  const { data, error } = (await supabase
    .from("integrations")
    .select("id, practice_id, display_name, settings")
    .in("source_system", ["boxly", "leadflo", "dengro"])
    .in("status", ["connected", "error"])) as SupabaseResult<IntegrationRow[]>;

  if (error) {
    return NextResponse.json(
      { error: "integration_lookup_failed", detail: error.code },
      { status: 500 },
    );
  }

  const results = [];
  for (const integration of (data ?? []).filter((row) => row.settings?.chatHistorySessionPrefix)) {
    try {
      const result = await syncAiBookings(supabase, integration.id);
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

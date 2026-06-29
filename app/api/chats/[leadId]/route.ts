import { NextRequest, NextResponse } from "next/server";
import { resolvePracticeMembership } from "@/lib/dental-auth";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** Full read-only transcript for one dental lead. */
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
  if (!supabase) return NextResponse.json({ messages: [] });

  const { data: lead } = await supabase
    .from("leads")
    .select("id, practice_id")
    .eq("id", leadId)
    .eq("practice_id", membership.practiceId)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "lead_not_found" }, { status: 404 });

  const { data } = await supabase
    .from("messages")
    .select("id, direction, body, ai_generated, external_payload, created_at")
    .eq("practice_id", membership.practiceId)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true })
    .limit(500);

  return NextResponse.json({
    messages: (data ?? []).map((message) => {
      const payload = (message.external_payload ?? {}) as { sender?: unknown; type?: unknown };
      return {
        id: message.id,
        direction: message.direction,
        body: message.body,
        aiGenerated: Boolean(message.ai_generated),
        sender: typeof payload.sender === "string" ? payload.sender : null,
        kind: typeof payload.type === "string" ? payload.type : null,
        createdAt: message.created_at,
      };
    }),
  });
}

/** Manual sending is intentionally disabled in the dashboard parity slice. */
export async function POST() {
  return NextResponse.json({ error: "manual_sending_not_enabled" }, { status: 403 });
}

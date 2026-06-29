import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveTenantId } from "@/lib/auth";

/** Conversation list: leads that have at least one message, latest first. */
export async function GET(req: NextRequest) {
  const tenantId = await resolveTenantId(req.nextUrl.searchParams.get("tenantId"));
  if (!tenantId) return NextResponse.json({ error: "missing_tenant" }, { status: 400 });

  const supabase = supabaseAdmin();
  if (!supabase) return NextResponse.json({ chats: [] });

  const { data: messages, error } = await supabase
    .from("messages")
    .select("lead_id, direction, body, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    console.error("chats list failed:", error);
    return NextResponse.json({ error: "list_failed" }, { status: 500 });
  }

  // Group to latest message per lead.
  const latest = new Map<string, { body: string; direction: string; at: string; count: number }>();
  for (const m of messages ?? []) {
    if (!m.lead_id) continue;
    const cur = latest.get(m.lead_id);
    if (!cur) {
      latest.set(m.lead_id, { body: m.body, direction: m.direction, at: m.created_at, count: 1 });
    } else {
      cur.count++;
    }
  }
  if (latest.size === 0) return NextResponse.json({ chats: [] });

  const { data: leads } = await supabase
    .from("leads")
    .select("id, first_name, last_name, phone, registration, status")
    .eq("tenant_id", tenantId)
    .in("id", [...latest.keys()]);

  const chats = (leads ?? [])
    .map((l) => {
      const m = latest.get(l.id)!;
      return {
        leadId: l.id,
        name: [l.first_name, l.last_name].filter(Boolean).join(" ") || l.phone,
        phone: l.phone,
        registration: l.registration,
        status: l.status,
        lastMessage: m.body,
        lastDirection: m.direction,
        lastAt: m.at,
        messageCount: m.count,
      };
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));

  return NextResponse.json({ chats });
}

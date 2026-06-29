import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { chatComplete } from "@/lib/llm";
import { tenantSystemPrompt, type TenantRow } from "@/lib/engine/prompt";
import { sendMessage, tagHandoff, wasupPhone } from "@/lib/engine/wasup";

export const maxDuration = 120;

type Intent = "none" | "stop" | "handoff" | "booking";
type LeadContact = {
  lead: {
    id: string;
    status: string;
    first_name: string | null;
  };
  sessionId: string | null;
};

const RESPONSE_RULES = `

## Response format (strict)
Reply ONLY with JSON, no prose around it:
{"reply": "<your WhatsApp reply>", "intent": "none|stop|handoff|booking", "booking_datetime": "<ISO 8601 if the customer agreed a specific day/time, else empty>"}
- intent "stop": the customer asked to stop messages / unsubscribe.
- intent "handoff": they're upset, confused, or explicitly want a human.
- intent "booking": they've agreed to book; fill booking_datetime when a concrete day/time was agreed.
- otherwise "none".`;

async function findLeadWeContactedFirst(
  supabase: NonNullable<ReturnType<typeof supabaseAdmin>>,
  tenantId: string,
  phone: string,
): Promise<LeadContact | null> {
  const { data: leads } = await supabase
    .from("leads")
    .select("id, status, first_name, updated_at, created_at")
    .eq("tenant_id", tenantId)
    .eq("phone", phone)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(20);

  for (const lead of leads ?? []) {
    const [{ data: sessions }, { data: outbound }] = await Promise.all([
      supabase
        .from("lead_sessions")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: false })
        .limit(1),
      supabase
        .from("messages")
        .select("id, delivery_status, session_id")
        .eq("tenant_id", tenantId)
        .eq("lead_id", lead.id)
        .eq("direction", "outbound")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    const sessionId = sessions?.[0]?.id ?? null;
    const sentOutbound = (outbound ?? []).find((m) => m.delivery_status !== "failed");

    if (sessionId || sentOutbound) {
      return {
        lead: {
          id: lead.id,
          status: lead.status,
          first_name: lead.first_name,
        },
        sessionId: sessionId ?? sentOutbound?.session_id ?? null,
      };
    }
  }

  return null;
}

/** Inbound Wasup webhook: replies as the tenant's agent and records everything. */
export async function POST(req: NextRequest) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (await req.json().catch(() => ({}))) as any;
  const p = raw?.body ?? raw ?? {};

  const instanceId: string | null = p.instance_id ?? p.instanceId ?? null;
  const fromPhone: string | null = p.from_phone ?? p.from ?? null;
  const toPhone: string | null = p.to_phone ?? p.to ?? null;
  const text: string | null = p.message ?? p.text ?? null;
  const waMessageId: string | null = p.message_id ?? p.messageId ?? null;

  const supabase = supabaseAdmin();
  if (!supabase) return NextResponse.json({ ok: true, ignored: "no_storage" });

  // Delivery acks (status updates without a message body)
  if (!text && waMessageId && p.status) {
    await supabase
      .from("messages")
      .update({ delivery_status: String(p.status) })
      .eq("wa_message_id", waMessageId);
    return NextResponse.json({ ok: true, ack: true });
  }
  if (!text || !fromPhone) return NextResponse.json({ ok: true, ignored: "not_a_message" });

  // ── Resolve tenant ──
  let tenantQuery = supabase
    .from("tenants")
    .select(
      "id, name, address, phone, website, opening_hours, mot_classes, prices, free_retest, tone, wasup_instance_id",
    );
  if (instanceId) {
    tenantQuery = tenantQuery.eq("wasup_instance_id", instanceId);
  } else if (toPhone) {
    tenantQuery = tenantQuery.eq("wasup_phone", wasupPhone(toPhone));
  } else {
    return NextResponse.json({ ok: true, ignored: "no_tenant_hint" });
  }
  const { data: tenant } = await tenantQuery.maybeSingle<TenantRow>();
  if (!tenant) return NextResponse.json({ ok: true, ignored: "unknown_tenant" });

  // ── Resolve contacted lead ──
  const e164 = "+" + wasupPhone(fromPhone);
  const contacted = await findLeadWeContactedFirst(supabase, tenant.id, e164);
  if (!contacted) {
    return NextResponse.json({ ok: true, ignored: "not_previously_contacted" });
  }
  const { lead, sessionId } = contacted;

  const { data: activeConfig } = await supabase
    .from("agent_configs")
    .select("system_prompt")
    .eq("tenant_id", tenant.id)
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle<{ system_prompt: string }>();

  // ── Log inbound ──
  await supabase.from("messages").insert({
    tenant_id: tenant.id,
    lead_id: lead.id,
    session_id: sessionId,
    direction: "inbound",
    body: text,
    wa_message_id: waMessageId,
  });

  // ── Build history & ask the agent ──
  const { data: history } = await supabase
    .from("messages")
    .select("direction, body")
    .eq("tenant_id", tenant.id)
    .eq("lead_id", lead.id)
    .order("created_at", { ascending: false })
    .limit(20);

  const chat = (history ?? [])
    .reverse()
    .map((m) => ({
      role: m.direction === "inbound" ? ("user" as const) : ("assistant" as const),
      content: m.body,
    }));

  let reply = "";
  let intent: Intent = "none";
  let bookingDatetime: string | null = null;
  try {
    const out = await chatComplete(
      [
        {
          role: "system",
          content: (activeConfig?.system_prompt ?? tenantSystemPrompt(tenant)) + RESPONSE_RULES,
        },
        ...chat,
      ],
      { json: true },
    );
    const parsed = JSON.parse(out);
    reply = String(parsed.reply ?? "").trim();
    intent = (["none", "stop", "handoff", "booking"].includes(parsed.intent)
      ? parsed.intent
      : "none") as Intent;
    bookingDatetime = parsed.booking_datetime?.trim() || null;
  } catch (err) {
    console.error("inbound agent failed:", err);
    return NextResponse.json({ ok: true, agent: "failed" });
  }

  // ── Act on intent ──
  if (intent === "stop") {
    await supabase.from("leads").update({ status: "opted_out" }).eq("id", lead.id);
    await supabase
      .from("lead_sessions")
      .update({ state: "stopped" })
      .eq("lead_id", lead.id)
      .eq("state", "active");
  } else {
    if (lead.status === "contacted" || lead.status === "new") {
      await supabase.from("leads").update({ status: "replied" }).eq("id", lead.id);
    }
    await supabase
      .from("lead_sessions")
      .update({ state: "replied" })
      .eq("lead_id", lead.id)
      .eq("state", "active");
  }

  if (intent === "handoff" && tenant.wasup_instance_id) {
    await tagHandoff(tenant.wasup_instance_id, e164).catch(() => false);
  }

  if (intent === "booking") {
    const slot = bookingDatetime && !Number.isNaN(Date.parse(bookingDatetime))
      ? new Date(bookingDatetime).toISOString()
      : null;
    if (slot) {
      await supabase.from("bookings").insert({
        tenant_id: tenant.id,
        lead_id: lead.id,
        slot_start: slot,
        created_via: "agent",
      });
    }
    await supabase.from("leads").update({ status: "booked" }).eq("id", lead.id);
    await supabase
      .from("lead_sessions")
      .update({ state: "booked" })
      .eq("lead_id", lead.id)
      .in("state", ["active", "replied"]);
  }

  // ── Send + log the reply ──
  if (reply && tenant.wasup_instance_id) {
    const outcome = await sendMessage(tenant.wasup_instance_id, e164, reply);
    await supabase.from("messages").insert({
      tenant_id: tenant.id,
      lead_id: lead.id,
      direction: "outbound",
      body: reply,
      wa_message_id: outcome.messageId,
      delivery_status: outcome.ok ? "sent" : "failed",
    });
  }

  return NextResponse.json({ ok: true, intent, replied: Boolean(reply) });
}

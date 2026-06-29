import type { SupabaseClient } from "@supabase/supabase-js";
import { motStateFromDate } from "@/lib/mot";
import { chatComplete } from "@/lib/llm";
import { firstMessageInstruction, tenantSystemPrompt, type LeadRow, type TenantRow } from "./prompt";
import { sendMessage } from "./wasup";

export type TenantResult = {
  tenantId: string;
  tenant: string;
  sent: number;
  skipped: string | null;
  eligible?: number;
};

const TENANT_SELECT =
  "id, name, address, phone, website, opening_hours, mot_classes, prices, free_retest, tone, wasup_instance_id, tenant_settings(*)";

/**
 * Master kill-switch for the legacy native sending engine.
 *
 * In V3 the n8n worker owns all outbound sending, so this native path must stay
 * OFF in every deployed environment unless someone deliberately opts in. Without
 * this guard, the Vercel cron (/api/engine/outbound) could message real patients
 * the moment the app is deployed. Default = disabled.
 */
export function outboundEngineEnabled(): boolean {
  return process.env.OUTBOUND_ENGINE_ENABLED === "true";
}

/** True when an outreach run is actively claiming/sending for this garage. */
export async function isOutreachInProgress(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<boolean> {
  const { count } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("status", "queued");
  return (count ?? 0) > 0;
}

export async function runOutboundBatch(supabase: SupabaseClient): Promise<TenantResult[]> {
  if (!outboundEngineEnabled()) return [];
  const { data: tenants, error } = await supabase
    .from("tenants")
    .select(TENANT_SELECT)
    .not("wasup_instance_id", "is", null);
  if (error) throw error;

  const results: TenantResult[] = [];
  for (const t of tenants ?? []) {
    const settings = Array.isArray(t.tenant_settings)
      ? t.tenant_settings[0]
      : t.tenant_settings;
    const result = await processTenant(
      supabase,
      t as unknown as TenantRow,
      settings ?? null,
    );
    results.push(result);
  }
  return results;
}

export async function runOutboundForTenant(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<TenantResult & { eligible: number }> {
  if (!outboundEngineEnabled()) {
    return { tenantId, tenant: "", sent: 0, skipped: "engine_disabled", eligible: 0 };
  }
  const { data: tenant, error } = await supabase
    .from("tenants")
    .select(TENANT_SELECT)
    .eq("id", tenantId)
    .maybeSingle();
  if (error) throw error;
  if (!tenant) {
    return { tenantId, tenant: "", sent: 0, skipped: "not_found", eligible: 0 };
  }
  if (!tenant.wasup_instance_id) {
    return {
      tenantId,
      tenant: tenant.name as string,
      sent: 0,
      skipped: "whatsapp_not_connected",
      eligible: 0,
    };
  }
  if (await isOutreachInProgress(supabase, tenantId)) {
    return {
      tenantId,
      tenant: tenant.name as string,
      sent: 0,
      skipped: "already_running",
      eligible: 0,
    };
  }
  const settings = Array.isArray(tenant.tenant_settings)
    ? tenant.tenant_settings[0]
    : tenant.tenant_settings;
  return processTenant(supabase, tenant as unknown as TenantRow, settings ?? null, {
    manual: true,
  });
}

type Settings = {
  auto_contact_enabled: boolean;
  daily_contact_cap: number;
  due_soon_days: number;
  sending_hours: { start: string; end: string } | null;
};

type RunOptions = {
  manual?: boolean;
};

type ActiveAgentConfig = {
  system_prompt: string;
  first_message_prompt: string | null;
};

/** Release stale in-flight claims (crashed serverless run). */
async function recoverStaleClaims(supabase: SupabaseClient, tenantId: string) {
  const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();
  await supabase
    .from("leads")
    .update({ status: "new" })
    .eq("tenant_id", tenantId)
    .eq("status", "queued")
    .lt("updated_at", cutoff);
}

/**
 * Atomically reserve a lead for outreach. Returns false if already contacted,
 * has a session, has an outbound message, or another run claimed it first.
 */
async function claimLead(
  supabase: SupabaseClient,
  tenantId: string,
  leadId: string,
): Promise<boolean> {
  const [{ count: sessions }, { count: outbound }] = await Promise.all([
    supabase
      .from("lead_sessions")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", leadId),
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", leadId)
      .eq("direction", "outbound"),
  ]);

  if ((sessions ?? 0) > 0 || (outbound ?? 0) > 0) return false;

  const { data } = await supabase
    .from("leads")
    .update({ status: "queued" })
    .eq("id", leadId)
    .eq("tenant_id", tenantId)
    .eq("status", "new")
    .select("id")
    .maybeSingle();

  return Boolean(data?.id);
}

async function releaseClaim(supabase: SupabaseClient, leadId: string) {
  await supabase.from("leads").update({ status: "new" }).eq("id", leadId).eq("status", "queued");
}

async function processTenant(
  supabase: SupabaseClient,
  tenant: TenantRow,
  settings: Settings | null,
  opts: RunOptions = {},
): Promise<TenantResult & { eligible: number }> {
  const base: TenantResult & { eligible: number } = {
    tenantId: tenant.id,
    tenant: tenant.name,
    sent: 0,
    skipped: null,
    eligible: 0,
  };

  if (!opts.manual) {
    if (!settings?.auto_contact_enabled) return { ...base, skipped: "auto_contact_off" };
    if (!withinSendingHours(settings.sending_hours)) return { ...base, skipped: "outside_hours" };
  }

  await recoverStaleClaims(supabase, tenant.id);

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { count: sentToday } = await supabase
    .from("lead_sessions")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id)
    .gte("created_at", dayStart.toISOString());

  const remaining = (settings?.daily_contact_cap ?? 20) - (sentToday ?? 0);
  if (remaining <= 0) return { ...base, skipped: "daily_cap_reached" };

  // Overdue + due-soon inside window — always include overdue (no toggle).
  const windowEnd = new Date();
  windowEnd.setUTCDate(windowEnd.getUTCDate() + (settings?.due_soon_days ?? 30));

  const { data: leads } = await supabase
    .from("leads")
    .select("id, first_name, last_name, phone, registration, vehicle, mot_due_date, status")
    .eq("tenant_id", tenant.id)
    .eq("status", "new")
    .or(`mot_due_date.is.null,mot_due_date.lte.${windowEnd.toISOString().slice(0, 10)}`)
    .order("mot_due_date", { ascending: true, nullsFirst: false })
    .limit(remaining);

  if (!leads || leads.length === 0) return { ...base, skipped: "no_eligible_leads" };
  base.eligible = leads.length;

  const { data: activeConfig } = await supabase
    .from("agent_configs")
    .select("system_prompt, first_message_prompt")
    .eq("tenant_id", tenant.id)
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle<ActiveAgentConfig>();

  const systemPrompt = activeConfig?.system_prompt ?? tenantSystemPrompt(tenant);
  const firstMessagePrompt = activeConfig?.first_message_prompt ?? null;

  for (const lead of leads as LeadRow[]) {
    const claimed = await claimLead(supabase, tenant.id, lead.id);
    if (!claimed) continue;

    try {
      const { days } = motStateFromDate(lead.mot_due_date);
      const message = (
        await chatComplete([
          { role: "system", content: systemPrompt },
          { role: "user", content: firstMessageInstruction(lead, days, firstMessagePrompt) },
        ])
      ).trim();
      if (!message) {
        await releaseClaim(supabase, lead.id);
        continue;
      }

      const outcome = await sendMessage(tenant.wasup_instance_id!, lead.phone, message);
      if (!outcome.ok) {
        console.warn(`send blocked for ${tenant.name}/${lead.phone}: ${outcome.blockedReason}`);
        await releaseClaim(supabase, lead.id);
        continue;
      }

      const { data: session } = await supabase
        .from("lead_sessions")
        .insert({
          tenant_id: tenant.id,
          lead_id: lead.id,
          state: "active",
          first_message: message,
        })
        .select("id")
        .single();

      await supabase.from("messages").insert({
        tenant_id: tenant.id,
        lead_id: lead.id,
        session_id: session?.id ?? null,
        direction: "outbound",
        body: message,
        wa_message_id: outcome.messageId,
        delivery_status: "sent",
      });

      await supabase.from("leads").update({ status: "contacted" }).eq("id", lead.id);

      base.sent++;

      await sleep(opts.manual ? 2000 + Math.random() * 3000 : 8000 + Math.random() * 12000);
    } catch (err) {
      console.error(`outbound failed for lead ${lead.id}:`, err);
      await releaseClaim(supabase, lead.id);
    }
  }

  return base;
}

function withinSendingHours(hours: { start: string; end: string } | null): boolean {
  if (!hours?.start || !hours?.end) return true;
  const now = new Date().toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return now >= hours.start && now <= hours.end;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

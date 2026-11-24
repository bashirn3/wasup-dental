import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { aiBookingsOf } from "@/lib/ai-bookings";
import { supabaseAdmin } from "@/lib/supabase";

type SupabaseResult<T> = {
  data: T | null;
  error: { code?: string; message: string } | null;
};

type IntegrationRow = {
  id: string;
  practice_id: string;
  display_name: string;
  settings: Record<string, unknown> | null;
};

type DengroOutbound = {
  status?: string | null;
  sent_at?: string | null;
};

type DengroLeadRow = {
  id: number;
  created_at: string | null;
  first_name: string | null;
  last_name: string | null;
  number: string | null;
  email: string | null;
  treatment: string | null;
  deposit_status: string | null;
  deposit_paid_at: string | null;
  dentally_appointment_id: string | number | null;
  raw_data: {
    source?: string | null;
    dengro?: { lead_uuid?: string | null; lead_received?: string | null; journey_status?: string | null } | null;
    outbound?: DengroOutbound | null;
  } | null;
};

export type DengroMirrorResult = {
  practiceId: string;
  integrationId: string;
  displayName: string;
  table: string;
  leadsUpserted: number;
  sourceCount: number;
};

const SOURCE_SYSTEM = "dengro";

const LEAD_COLUMNS =
  "id, created_at, first_name, last_name, number, email, treatment, deposit_status, deposit_paid_at, dentally_appointment_id, raw_data";

/**
 * Mirror a practice whose leads arrive from Dengro.
 *
 * n8n's intake workflow writes each Dengro lead to one row of the practice's
 * leads table, and the outbound workflow records Jo's first message on that same
 * row. Who is booked comes from Jo's confirmations, found by the booking sync.
 */
export async function mirrorDengroPractice(
  practiceId: string,
  integrationId: string,
): Promise<DengroMirrorResult> {
  const ours = supabaseAdmin();
  if (!ours) throw new Error("storage_unavailable");

  const { data: integration, error: integrationError } = (await ours
    .from("integrations")
    .select("id, practice_id, display_name, settings")
    .eq("id", integrationId)
    .eq("practice_id", practiceId)
    .maybeSingle()) as SupabaseResult<IntegrationRow>;
  if (integrationError) throw new Error(`integration_lookup_failed:${integrationError.code ?? integrationError.message}`);
  if (!integration) throw new Error("dengro_integration_not_found");

  const settings = integration.settings ?? {};
  const table = typeof settings.leadsTable === "string" ? settings.leadsTable : "";
  const urlEnv = typeof settings.supabaseUrlEnv === "string" ? settings.supabaseUrlEnv : "";
  const keyEnv = typeof settings.supabaseServiceRoleKeyEnv === "string" ? settings.supabaseServiceRoleKeyEnv : "";
  if (!/^[a-z0-9_]+$/.test(table)) throw new Error("invalid_leads_table");
  const url = process.env[urlEnv];
  const key = process.env[keyEnv];
  if (!url || !key) throw new Error("dengro_source_env_missing");

  try {
    const source = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = (await source
      .from(table)
      .select(LEAD_COLUMNS)
      .order("created_at", { ascending: false })) as SupabaseResult<DengroLeadRow[]>;
    if (error) throw new Error(`dengro_leads_read_failed:${error.code ?? error.message}`);
    const rows = data ?? [];

    const now = new Date().toISOString();
    const booked = aiBookingsOf(settings);
    const records = rows.map((row) => normalizeLead(row, practiceId, now, booked));
    let leadsUpserted = 0;
    for (let index = 0; index < records.length; index += 500) {
      const chunk = records.slice(index, index + 500);
      const { error: upsertError } = await ours
        .from("leads")
        .upsert(chunk, { onConflict: "practice_id,source_system,external_id" });
      if (upsertError) throw new Error(`lead_upsert_failed:${upsertError.code ?? upsertError.message}`);
      leadsUpserted += chunk.length;
    }

    await recordBookingActivity(ours, practiceId, rows);
    await finishSync(ours, practiceId, integration.id, "connected");

    return {
      practiceId,
      integrationId: integration.id,
      displayName: integration.display_name,
      table,
      leadsUpserted,
      sourceCount: rows.length,
    };
  } catch (syncError) {
    await finishSync(ours, practiceId, integration.id, "error");
    throw syncError;
  }
}

function normalizeLead(row: DengroLeadRow, practiceId: string, now: string, booked: Record<string, string>) {
  const outbound = row.raw_data?.outbound ?? null;
  const dengro = row.raw_data?.dengro ?? null;
  const messaged = outbound?.status === "sent";
  const enquiredAt = dengro?.lead_received ?? row.created_at ?? now;
  const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();

  return {
    practice_id: practiceId,
    name: name || "Unknown patient",
    phone: row.number ? `+${row.number.replace(/\D/g, "")}` : null,
    email: row.email ?? null,
    treatment: treatmentFromDengro(row.treatment),
    status: booked[String(row.id)] ? "booked" : messaged ? "engaged" : "new",
    source: row.raw_data?.source ?? SOURCE_SYSTEM,
    source_system: SOURCE_SYSTEM,
    external_id: String(row.id),
    external_payload: {
      legacy: {
        aiActioned: messaged,
        actionedAt: messaged ? outbound?.sent_at ?? null : null,
        aiActionedAt: messaged ? outbound?.sent_at ?? null : null,
        becameLeadAt: enquiredAt,
        dengroLeadId: dengro?.lead_uuid ?? null,
        journeyStatus: dengro?.journey_status ?? null,
        outboundStatus: outbound?.status ?? null,
        depositStatus: row.deposit_status ?? null,
        dentallyAppointmentId: row.dentally_appointment_id ?? null,
      },
    },
    box_name: row.treatment ?? null,
    box_stage: null,
    needs_human: false,
    last_synced_at: now,
    updated_at: enquiredAt,
  };
}

function treatmentFromDengro(treatment: string | null) {
  const value = (treatment ?? "").toLowerCase();
  if (value.includes("implant")) return "implants";
  if (value.includes("invisalign")) return "invisalign";
  if (value.includes("brace")) return "ortho";
  if (value.includes("whiten")) return "whitening";
  return "general";
}

/** When Stripe last took a deposit and when one last became an appointment. */
async function recordBookingActivity(ours: SupabaseClient, practiceId: string, rows: DengroLeadRow[]) {
  let lastDepositAt: string | null = null;
  let lastBookingAt: string | null = null;
  for (const row of rows) {
    const paidAt = row.deposit_paid_at;
    if (!paidAt) continue;
    if (!lastDepositAt || paidAt > lastDepositAt) lastDepositAt = paidAt;
    if (row.dentally_appointment_id != null && (!lastBookingAt || paidAt > lastBookingAt)) lastBookingAt = paidAt;
  }

  const updates: Array<[string, string]> = [];
  if (lastBookingAt) updates.push(["dentally", lastBookingAt]);
  if (lastDepositAt) updates.push(["stripe", lastDepositAt]);
  await Promise.all(
    updates.map(([sourceSystem, at]) =>
      ours
        .from("integrations")
        .update({ last_synced_at: at, updated_at: new Date().toISOString() })
        .eq("practice_id", practiceId)
        .eq("source_system", sourceSystem),
    ),
  );
}

async function finishSync(
  ours: SupabaseClient,
  practiceId: string,
  integrationId: string,
  status: "connected" | "error",
) {
  const finishedAt = new Date().toISOString();
  await Promise.all([
    ours
      .from("integrations")
      .update({ last_synced_at: finishedAt, updated_at: finishedAt, status })
      .eq("id", integrationId),
    status === "connected"
      ? ours.from("practices").update({ last_synced_at: finishedAt }).eq("id", practiceId)
      : Promise.resolve(),
  ]);
}

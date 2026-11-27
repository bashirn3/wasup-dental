import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type SupabaseResult<T> = {
  data: T | null;
  error: { code?: string; message: string } | null;
};

type LeadRow = {
  id: string;
  external_id: string | null;
  phone: string | null;
  status: string;
  updated_at: string;
};

type ChatRow = {
  session_id: string;
  message: { content?: unknown } | null;
  timestamp: string | null;
};

/** Lead external id → when the agent confirmed their booking. */
export type AiBookings = Record<string, string>;

export type AiBookingsResult = {
  practiceId: string;
  integrationId: string;
  checked: number;
  newlyBooked: number;
  totalBooked: number;
};

/**
 * The agent telling a patient their slot is booked. Written for the replies the
 * agents actually send: "You're booked for your Invisalign consultation on…",
 * "Your consultation is now booked for…", "Payment received! Your appointment is
 * booked for…", "Your appointment was recorded for…".
 */
const CONFIRMED =
  /(\b(you'?re|you’re|you are|is|are|has been|have been|been) (now |all |successfully )?(booked|confirmed) (in|for|on|with)\b|\bbooked you (in|for)\b|\bthis is (now )?booked\b|appointment for .{3,80} is confirmed on|\byour (appointment|consultation|booking) (is|has been) (now )?(booked|confirmed)\b|\byour (appointment|consultation|booking) (was|is|has been) (now )?recorded for\b)/i;

/**
 * Offers and holds that use the same words. A slot held until a deposit is paid
 * is not booked yet; the Stripe workflow sends its own confirmation once it is.
 */
const NOT_YET =
  /(once (paid|you|the deposit)|to secure|secure your|lock in|pay (your|the) .{0,20}deposit|deposit here|would you like|shall i|can i book|could i|if you'?d like|when you (are|pay)|haven.t been booked|not (yet )?(been )?booked|isn.t booked)/i;

const SESSION_BATCH = 120;

export function aiBookingsOf(settings: Record<string, unknown> | null | undefined): AiBookings {
  const value = settings?.aiBookings;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AiBookings) : {};
}

/**
 * Find the leads the agent has confirmed a booking with, from n8n's chat memory.
 *
 * Only leads the agent has spoken to (engaged) are looked up, by their exact
 * session ids: the chat table is shared with other clients' agents and cannot be
 * searched by prefix without scanning all of it. A confirmation stays found, so
 * the result is kept on the integration and each run only checks the rest.
 */
export async function syncAiBookings(
  ours: SupabaseClient,
  integrationId: string,
): Promise<AiBookingsResult> {
  const { data: integration, error } = (await ours
    .from("integrations")
    .select("id, practice_id, source_system, settings")
    .eq("id", integrationId)
    .maybeSingle()) as SupabaseResult<{
    id: string;
    practice_id: string;
    source_system: string;
    settings: Record<string, unknown> | null;
  }>;
  if (error) throw new Error(`integration_lookup_failed:${error.code ?? error.message}`);
  if (!integration) throw new Error("integration_not_found");

  const settings = integration.settings ?? {};
  const prefix = typeof settings.chatHistorySessionPrefix === "string" ? settings.chatHistorySessionPrefix : "";
  if (!prefix) throw new Error("chat_history_prefix_missing");
  const urlEnv = [settings.legacySupabaseUrlEnv, settings.supabaseUrlEnv, settings.bookingSupabaseUrlEnv].find(
    (value): value is string => typeof value === "string",
  );
  const keyEnv = [
    settings.legacySupabaseServiceRoleKeyEnv,
    settings.supabaseServiceRoleKeyEnv,
    settings.bookingSupabaseServiceRoleKeyEnv,
  ].find((value): value is string => typeof value === "string");
  const url = urlEnv ? process.env[urlEnv] : undefined;
  const key = keyEnv ? process.env[keyEnv] : undefined;
  if (!url || !key) throw new Error("chat_history_env_missing");
  const chat = createClient(url, key, { auth: { persistSession: false } });

  const practiceId = integration.practice_id;
  const known = aiBookingsOf(settings);
  const leads = await loadEngagedLeads(ours, practiceId, integration.source_system);

  // Boxly's agents key the session by Boxly lead id (the earliest ones by phone);
  // the others by phone. A phone shared by several enquiries belongs to the newest.
  const leadBySession = new Map<string, LeadRow>();
  for (const lead of leads) {
    if (!lead.external_id || known[lead.external_id]) continue;
    if (integration.source_system === "boxly") leadBySession.set(prefix + lead.external_id, lead);
    const digits = (lead.phone ?? "").replace(/\D/g, "");
    if (!digits) continue;
    const current = leadBySession.get(prefix + digits);
    if (!current || lead.updated_at > current.updated_at) leadBySession.set(prefix + digits, lead);
  }

  const found: AiBookings = {};
  const sessions = [...leadBySession.keys()];
  for (let index = 0; index < sessions.length; index += SESSION_BATCH) {
    const { data, error: chatError } = (await chat
      .from("chat_history")
      .select("session_id, message, timestamp")
      .eq("message->>type", "ai")
      .in("session_id", sessions.slice(index, index + SESSION_BATCH))) as SupabaseResult<ChatRow[]>;
    if (chatError) throw new Error(`chat_history_read_failed:${chatError.code ?? chatError.message}`);
    for (const row of data ?? []) {
      const lead = leadBySession.get(row.session_id);
      if (!lead?.external_id || !isConfirmation(replyText(row.message?.content))) continue;
      const at = row.timestamp ?? new Date().toISOString();
      if (!found[lead.external_id] || at < found[lead.external_id]) found[lead.external_id] = at;
    }
  }

  const newIds = Object.keys(found);
  if (newIds.length) {
    // Re-read so a lead sync that saved settings meanwhile is not overwritten.
    const { data: fresh } = (await ours
      .from("integrations")
      .select("settings")
      .eq("id", integration.id)
      .maybeSingle()) as SupabaseResult<{ settings: Record<string, unknown> | null }>;
    const freshSettings = fresh?.settings ?? settings;
    const merged = { ...aiBookingsOf(freshSettings), ...found };
    const { error: saveError } = await ours
      .from("integrations")
      .update({ settings: { ...freshSettings, aiBookings: merged }, updated_at: new Date().toISOString() })
      .eq("id", integration.id);
    if (saveError) throw new Error(`ai_bookings_save_failed:${saveError.code ?? saveError.message}`);

    for (let index = 0; index < newIds.length; index += 200) {
      const { error: updateError } = await ours
        .from("leads")
        .update({ status: "booked" })
        .eq("practice_id", practiceId)
        .eq("source_system", integration.source_system)
        .in("external_id", newIds.slice(index, index + 200));
      if (updateError) throw new Error(`booked_update_failed:${updateError.code ?? updateError.message}`);
    }
  }

  return {
    practiceId,
    integrationId: integration.id,
    checked: sessions.length,
    newlyBooked: newIds.length,
    totalBooked: Object.keys(known).length + newIds.length,
  };
}

async function loadEngagedLeads(ours: SupabaseClient, practiceId: string, sourceSystem: string) {
  const leads: LeadRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = (await ours
      .from("leads")
      .select("id, external_id, phone, status, updated_at")
      .eq("practice_id", practiceId)
      .eq("source_system", sourceSystem)
      .in("status", ["engaged", "booked"])
      .order("id")
      .range(from, from + 999)) as SupabaseResult<LeadRow[]>;
    if (error) throw new Error(`lead_lookup_failed:${error.code ?? error.message}`);
    leads.push(...(data ?? []));
    if ((data ?? []).length < 1000) return leads;
  }
}

/** Agents save either plain text or their structured output as JSON. */
export function replyText(content: unknown): string {
  let value: unknown = content;
  if (typeof value === "string" && value.trimStart().startsWith("{")) {
    try {
      value = JSON.parse(value);
    } catch {
      return value as string;
    }
  }
  while (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    value = record.output ?? record.response ?? record.message ?? record.text ?? "";
  }
  return typeof value === "string" ? value : "";
}

function isConfirmation(text: string) {
  return CONFIRMED.test(text) && !NOT_YET.test(text);
}

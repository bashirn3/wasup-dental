import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FunnelLeadRow, FunnelNote } from "./admin-attribution-funnel";
import { replyText } from "./ai-bookings";
import {
  BOOKING_COLUMNS,
  bookingsByNumber,
  digitsOf,
  emptyConversation,
  fetchLeads,
  mergeRepeatEnquiries,
  toFunnelRow,
  type BookingRow,
  type Conversation,
  type WasupFunnelPractice,
} from "./funnel-dental-aesthetica";
import { supabaseAdmin } from "./supabase";

/**
 * Leigh Dental Centre's half of the attribution funnel.
 *
 * Its leads arrive from Dengro into one table that n8n's workflows also book
 * against: the same row holds Jo's opener, the Stripe deposit and the Dentally
 * appointment id, so a booking is proved the same way as Dental Aesthetica's.
 * What differs is the conversation, which is kept only in n8n's chat memory.
 */

export const LEIGH_PRACTICE_NAME = "Leigh Dental Centre";
export const LEIGH_CONSULT_VALUE = 20;

const LEIGH: WasupFunnelPractice = {
  key: "leigh",
  label: LEIGH_PRACTICE_NAME,
  consultValue: LEIGH_CONSULT_VALUE,
};

// Small enough that a batch's messages stay under the 1,000-row response cap.
const SESSION_BATCH = 50;

type ChatRow = {
  session_id: string;
  message: { type?: unknown; content?: unknown } | null;
  timestamp: string | null;
};

type Source = { client: SupabaseClient; table: string; prefix: string };

export async function buildLeighRows(): Promise<{ rows: FunnelLeadRow[]; testRowsExcluded: number }> {
  const practiceId = await leighPracticeId();
  if (!practiceId) return { rows: [], testRowsExcluded: 0 };

  const source = await loadSource(practiceId);
  const leads = await fetchLeads(practiceId);
  const [bookings, chats] = await Promise.all([
    fetchBookings(source),
    fetchChats(source, leads.map((lead) => lead.phone)),
  ]);

  const conversations = new Map<string, Conversation>();
  for (const row of chats) {
    const current = conversations.get(row.session_id) ?? emptyConversation();
    const type = row.message?.type;
    const at = row.timestamp;
    if (type === "ai") {
      current.outbound += 1;
      if (at && (!current.firstOutboundAt || at < current.firstOutboundAt)) current.firstOutboundAt = at;
    } else if (type === "human") {
      current.inbound += 1;
    } else {
      continue;
    }
    if (at && (!current.lastAt || at > current.lastAt)) current.lastAt = at;
    conversations.set(row.session_id, current);
  }

  const rows = leads.map((lead) =>
    toFunnelRow(
      lead,
      conversations.get(sessionOf(source, lead.phone)) ?? emptyConversation(),
      bookings.get(digitsOf(lead.phone)),
      LEIGH,
    ),
  );
  return { rows: mergeRepeatEnquiries(rows), testRowsExcluded: 0 };
}

/** Jo's conversation with the patient, read from n8n's chat memory. */
export async function getLeighNotes(leadId: string): Promise<FunnelNote[]> {
  const ours = supabaseAdmin();
  if (!ours) throw new Error("storage_unavailable");
  const practiceId = await leighPracticeId();
  if (!practiceId) return [];

  const { data: lead, error } = await ours
    .from("leads")
    .select("phone")
    .eq("id", leadId)
    .eq("practice_id", practiceId)
    .maybeSingle<{ phone: string | null }>();
  if (error) throw new Error(`lead_lookup_failed:${error.message}`);
  if (!lead?.phone) return [];

  const source = await loadSource(practiceId);
  const chats = await fetchChats(source, [lead.phone]);
  return chats
    .filter((row) => row.message?.type === "ai" || row.message?.type === "human")
    .map((row, index) => {
      const fromAgent = row.message?.type === "ai";
      return {
        id: `${leadId}-${index}`,
        title: fromAgent ? "Jo" : "Patient",
        description: replyText(row.message?.content),
        createdAt: row.timestamp,
        createdBy: fromAgent ? "WhatsApp agent" : null,
      };
    });
}

async function leighPracticeId(): Promise<string | null> {
  const ours = supabaseAdmin();
  if (!ours) throw new Error("storage_unavailable");
  const { data, error } = await ours
    .from("practices")
    .select("id")
    .eq("name", LEIGH_PRACTICE_NAME)
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`practice_lookup_failed:${error.message}`);
  return data?.id ?? null;
}

async function loadSource(practiceId: string): Promise<Source> {
  const ours = supabaseAdmin();
  if (!ours) throw new Error("storage_unavailable");
  const { data, error } = await ours
    .from("integrations")
    .select("settings")
    .eq("practice_id", practiceId)
    .eq("source_system", "dengro")
    .maybeSingle<{ settings: Record<string, unknown> | null }>();
  if (error) throw new Error(`integration_lookup_failed:${error.message}`);

  const settings = data?.settings ?? {};
  const table = typeof settings.leadsTable === "string" ? settings.leadsTable : "";
  const prefix = typeof settings.chatHistorySessionPrefix === "string" ? settings.chatHistorySessionPrefix : "";
  const urlEnv = typeof settings.supabaseUrlEnv === "string" ? settings.supabaseUrlEnv : "";
  const keyEnv = typeof settings.supabaseServiceRoleKeyEnv === "string" ? settings.supabaseServiceRoleKeyEnv : "";
  const url = process.env[urlEnv];
  const key = process.env[keyEnv];
  if (!/^[a-z0-9_]+$/.test(table) || !prefix) throw new Error("dengro_integration_incomplete");
  if (!url || !key) throw new Error("dengro_source_env_missing");

  return { client: createClient(url, key, { auth: { persistSession: false } }), table, prefix };
}

async function fetchBookings(source: Source): Promise<Map<string, BookingRow>> {
  const { data, error } = await source.client.from(source.table).select(BOOKING_COLUMNS);
  if (error) throw new Error(`booking_lookup_failed:${error.code ?? error.message}`);
  return bookingsByNumber((data ?? []) as BookingRow[]);
}

/** n8n keys a Leigh conversation by the patient's full number. */
function sessionOf(source: Source, phone: string | null): string {
  return source.prefix + String(phone ?? "").replace(/\D/g, "");
}

/**
 * By exact session id only: the chat table is shared with other clients' live
 * agents and cannot be searched by prefix without scanning all of it.
 */
async function fetchChats(source: Source, phones: Array<string | null>): Promise<ChatRow[]> {
  const sessions = [
    ...new Set(phones.filter((phone) => digitsOf(phone)).map((phone) => sessionOf(source, phone))),
  ];
  const rows: ChatRow[] = [];
  for (let index = 0; index < sessions.length; index += SESSION_BATCH) {
    const { data, error } = await source.client
      .from("chat_history")
      .select("session_id, message, timestamp")
      .in("session_id", sessions.slice(index, index + SESSION_BATCH))
      .order("id");
    if (error) throw new Error(`chat_history_read_failed:${error.code ?? error.message}`);
    rows.push(...((data ?? []) as ChatRow[]));
  }
  return rows;
}

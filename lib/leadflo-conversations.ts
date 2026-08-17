import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Leadflo conversation mirror.
 *
 * WF-2 writes every turn of a WhatsApp conversation back to Leadflo as a note
 * prefixed "Client:" or "AI:", so a patient's thread already exists in the CRM.
 * This copies those notes into the dashboard's messages table, which is what
 * the Chat tab reads. Without it a Leadflo lead opens onto an empty panel even
 * though Poppy has held a full conversation with them.
 *
 * The one turn missing from Leadflo is the opener WF-1 sends, which is taken from
 * the feeder's own record of the send instead.
 *
 * Rows are keyed on Leadflo's own note id, so a run is idempotent and the first
 * run over a lead is also its backfill: the entire history arrives at once,
 * each note carrying the time it was written rather than the time it was
 * imported.
 *
 * Read-only with respect to Leadflo and the feeder. Nothing here writes notes,
 * and nothing here messages anybody.
 */

type SupabaseResult<T> = {
  data: T | null;
  error: { code?: string; message: string } | null;
};

/** A row as the messages table takes it. Shared so a turn and an opener match. */
type MessageRow = {
  practice_id: string;
  lead_id: string;
  direction: "inbound" | "outbound";
  body: string;
  ai_generated: boolean;
  source_system: string;
  external_id: string;
  external_payload: Record<string, unknown>;
  created_at: string;
};

/** A note as the feeder's timeline route serialises it. */
type TimelineNote = {
  id?: string | null;
  title?: string | null;
  content?: string | null;
  datetime?: string | null;
};

export type ConversationLead = {
  /** Leadflo patient id. */
  externalId: string;
  /** Our leads.id, needed to hang the messages off the right row. */
  leadId: string;
  /**
   * The message WF-1 opened with, if it has been sent. Supplied separately
   * because it is the one turn Leadflo never learns about: WF-1 sends it through
   * Wasup and reports the result to the feeder, but writes no note. Without it a
   * thread starts on the patient's reply and reads as though they messaged the
   * practice out of nowhere.
   */
  opener?: LeadOpener | null;
};

export type LeadOpener = {
  body: string;
  /** When it was sent. Required: an opener we cannot place in time is dropped. */
  sentAt: string;
};

/**
 * What a lead's thread amounts to, for the counts and summaries the dashboard
 * shows beside them. Taken from the whole timeline rather than the rows just
 * inserted, so it stays right on a run that had nothing new to store.
 */
export type ConversationStat = {
  externalId: string;
  messages: number;
  /** Turns from the patient. None means we talked and they never answered. */
  inbound: number;
  lastAt: string | null;
  lastBody: string | null;
};

export type LeadfloConversationResult = {
  leadsScanned: number;
  notesSeen: number;
  messagesInserted: number;
  /** Leads whose timeline could not be read. One failure must not stop the rest. */
  failures: Array<{ externalId: string; error: string }>;
  stats: ConversationStat[];
};

const SOURCE_SYSTEM = "leadflo";

/**
 * Which notes are conversation turns. A patient's timeline also holds staff
 * notes and, on the test patients, leftovers from deployment checks; those are
 * not part of the thread and would read as Poppy talking nonsense.
 *
 * Exported because the history panel has to make the same call in reverse: it
 * shows everything on the timeline that is *not* a turn. Two copies of this rule
 * would eventually disagree and a note would show in both places or neither.
 */
export const CONVERSATION_TURN = /^\s*(ai|poppy|client|patient)\s*:\s*/i;
const CLINIC_SPEAKERS = new Set(["ai", "poppy"]);

/**
 * A conversation is short and a timeline read costs a live Leadflo call, so the
 * work is bounded per run. Anything left over is picked up by the next one.
 */
const DEFAULT_LEAD_CAP = 25;

export async function syncLeadfloConversations(args: {
  supabase: SupabaseClient;
  practiceId: string;
  feederBaseUrl: string;
  feederApiKey: string;
  leads: ConversationLead[];
  leadCap?: number;
}): Promise<LeadfloConversationResult> {
  const cap = args.leadCap ?? DEFAULT_LEAD_CAP;
  const scope = args.leads.slice(0, cap);

  const result: LeadfloConversationResult = {
    leadsScanned: scope.length,
    notesSeen: 0,
    messagesInserted: 0,
    failures: [],
    stats: [],
  };

  for (const lead of scope) {
    try {
      const notes = await fetchTimelineNotes(args.feederBaseUrl, args.feederApiKey, lead.externalId);
      result.notesSeen += notes.length;

      const turns = notes
        .map((note) => toMessageRow(note, args.practiceId, lead.leadId))
        .filter((row): row is MessageRow => row !== null);

      // Only add the opener if the thread does not already carry it. Nothing
      // writes it as a note today, but if that ever changes the note is the
      // better record of the two and this must not shadow it with a copy.
      const opener = toOpenerRow(lead, args.practiceId);
      const rows =
        opener && !turns.some((turn) => turn.body === opener.body) ? [opener, ...turns] : turns;
      if (!rows.length) continue;

      // Leadflo has been seen to repeat an id within a single timeline.
      const deduped = [...new Map(rows.map((row) => [row.external_id, row])).values()].sort((a, b) =>
        a.created_at.localeCompare(b.created_at),
      );

      const latest = deduped.at(-1) ?? null;
      result.stats.push({
        externalId: lead.externalId,
        messages: deduped.length,
        inbound: deduped.filter((row) => row.direction === "inbound").length,
        lastAt: latest?.created_at ?? null,
        lastBody: latest?.body ?? null,
      });

      // Insert what is new rather than upserting the lot. A note never changes
      // once written, and the unique index on messages is a partial one, which
      // Postgres will not accept as an ON CONFLICT target unless the statement
      // repeats the index predicate — something PostgREST cannot express. Asking
      // first keeps this idempotent without needing a schema change deployed
      // ahead of it.
      const known = await loadKnownNoteIds(
        args.supabase,
        args.practiceId,
        deduped.map((row) => row.external_id),
      );
      const fresh = deduped.filter((row) => !known.has(row.external_id));
      if (!fresh.length) continue;

      for (let index = 0; index < fresh.length; index += 500) {
        const chunk = fresh.slice(index, index + 500);
        const { error } = await args.supabase.from("messages").insert(chunk);
        if (error) throw new Error(`message_insert_failed:${error.code ?? error.message}`);
        result.messagesInserted += chunk.length;
      }
    } catch (error) {
      result.failures.push({
        externalId: lead.externalId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

/** Which of these Leadflo note ids we have already stored for this practice. */
async function loadKnownNoteIds(
  supabase: SupabaseClient,
  practiceId: string,
  noteIds: string[],
): Promise<Set<string>> {
  const known = new Set<string>();
  for (let index = 0; index < noteIds.length; index += 200) {
    const chunk = noteIds.slice(index, index + 200);
    const { data, error } = (await supabase
      .from("messages")
      .select("external_id")
      .eq("practice_id", practiceId)
      .eq("source_system", SOURCE_SYSTEM)
      .in("external_id", chunk)) as SupabaseResult<Array<{ external_id: string }>>;
    if (error) throw new Error(`message_lookup_failed:${error.code ?? error.message}`);
    for (const row of data ?? []) known.add(row.external_id);
  }
  return known;
}

async function fetchTimelineNotes(
  feederBaseUrl: string,
  feederApiKey: string,
  patientId: string,
): Promise<TimelineNote[]> {
  const response = await fetch(
    `${feederBaseUrl}/api/leads/${encodeURIComponent(patientId)}/timeline`,
    { headers: { "X-WF1-Key": feederApiKey }, cache: "no-store" },
  );

  if (!response.ok) throw new Error(`timeline_read_failed:${response.status}`);

  const body = (await response.json()) as { notes?: TimelineNote[] };
  return Array.isArray(body.notes) ? body.notes : [];
}

/**
 * The opener as a message, keyed on the send it came from.
 *
 * Keying on the time as well as the patient means a lead who was reset and
 * messaged again keeps both openers instead of the second one being mistaken for
 * the first and dropped. The feeder only ever holds the latest, so this is as far
 * back as that history can go.
 */
function toOpenerRow(lead: ConversationLead, practiceId: string): MessageRow | null {
  const opener = lead.opener;
  if (!opener) return null;

  const body = opener.body.trim();
  const sentAt = parseNoteTime(opener.sentAt);
  if (!body || !sentAt) return null;

  return {
    practice_id: practiceId,
    lead_id: lead.leadId,
    direction: "outbound",
    body,
    ai_generated: true,
    source_system: SOURCE_SYSTEM,
    external_id: `opener:${lead.externalId}:${sentAt}`,
    external_payload: { kind: "wf1_opener", outboundSentAt: opener.sentAt },
    created_at: sentAt,
  };
}

function toMessageRow(note: TimelineNote, practiceId: string, leadId: string): MessageRow | null {
  const noteId = note.id ? String(note.id) : null;
  const content = (note.content ?? "").trim();
  if (!noteId || !content) return null;

  const speaker = CONVERSATION_TURN.exec(content);
  if (!speaker) return null;

  const clinic = CLINIC_SPEAKERS.has(speaker[1].toLowerCase());
  const body = content.slice(speaker[0].length).trim();
  if (!body) return null;

  return {
    practice_id: practiceId,
    lead_id: leadId,
    direction: clinic ? "outbound" : "inbound",
    body,
    // Every clinic-side turn in a Leadflo thread came from Poppy: WF-2 is the
    // only thing that writes them, and a human replying does it in WhatsApp.
    ai_generated: clinic,
    source_system: SOURCE_SYSTEM,
    external_id: noteId,
    external_payload: {
      noteId,
      title: note.title ?? null,
      datetime: note.datetime ?? null,
    },
    // The note's own time, so a backfilled thread reads in the order it was
    // held rather than collapsing onto the moment it was imported.
    created_at: parseNoteTime(note.datetime) ?? new Date().toISOString(),
  };
}

/**
 * Leadflo stamps notes as "2026-08-09T21:54:13.000000Z". Postgres takes that,
 * but a malformed one would poison the whole batch, so it is checked here.
 */
function parseNoteTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

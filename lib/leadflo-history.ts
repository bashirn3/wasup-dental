import { CONVERSATION_TURN } from "@/lib/leadflo-conversations";

/**
 * A patient's history, as the practice should see it.
 *
 * The feeder's timeline route returns five collections. Three of them belong
 * here: staff notes, the stages the lead moved through, and Leadflo's own
 * activity record. Two are deliberately left out.
 *
 * Conversation turns are excluded because they are the Chat tab. Repeating them
 * would show every message twice, once as a message and once as a note, which is
 * how they are stored in Leadflo.
 *
 * The feeder's `localEvents` are excluded because they are its own operational
 * log — poll runs, webhook dispatches, refresh failures. There are roughly ten
 * of them per patient against two or three real events, so including them would
 * bury the history a practice cares about under our plumbing.
 */

export type HistoryKind = "note" | "stage" | "activity";

export type HistoryEntry = {
  id: string;
  kind: HistoryKind;
  /** ISO timestamp, or null when the source recorded none. */
  at: string | null;
  title: string;
  body: string | null;
};

type TimelineNote = {
  id?: string | null;
  title?: string | null;
  content?: string | null;
  datetime?: string | null;
};

type TimelineStageChange = {
  id?: string | number | null;
  from_stage?: string | null;
  to_stage?: string | null;
  changed_at?: string | null;
  detected_by?: string | null;
};

type TimelineActivity = {
  id?: string | number | null;
  type?: string | null;
  summary?: string | null;
  datetime?: string | null;
};

type TimelineResponse = {
  notes?: TimelineNote[];
  stageHistory?: TimelineStageChange[];
  activity?: TimelineActivity[];
};

/** One patient's history is short; this is a guard against a runaway timeline. */
const MAX_ENTRIES = 200;

export async function fetchLeadHistory(args: {
  baseUrl: string;
  apiKey: string;
  externalId: string;
}): Promise<HistoryEntry[]> {
  const response = await fetch(
    `${args.baseUrl}/api/leads/${encodeURIComponent(args.externalId)}/timeline`,
    { headers: { "X-WF1-Key": args.apiKey }, cache: "no-store" },
  );

  if (!response.ok) throw new Error(`timeline_read_failed:${response.status}`);

  return buildHistory((await response.json()) as TimelineResponse);
}

export function buildHistory(timeline: TimelineResponse): HistoryEntry[] {
  const entries: HistoryEntry[] = [];

  for (const note of timeline.notes ?? []) {
    const content = (note.content ?? "").trim();
    // A turn belongs to the Chat tab, and a note with no text is nothing.
    if (!content || CONVERSATION_TURN.test(content)) continue;

    entries.push({
      id: `note:${note.id ?? content.slice(0, 24)}`,
      kind: "note",
      at: isoOrNull(note.datetime),
      title: (note.title ?? "").trim() || "Note",
      body: content,
    });
  }

  for (const change of timeline.stageHistory ?? []) {
    const to = stageLabel(change.to_stage);
    if (!to) continue;
    const from = stageLabel(change.from_stage);

    entries.push({
      id: `stage:${change.id ?? `${change.changed_at}:${change.to_stage}`}`,
      kind: "stage",
      at: isoOrNull(change.changed_at),
      title: from ? `Moved from ${from} to ${to}` : `Moved to ${to}`,
      body: change.detected_by ? `Detected by ${change.detected_by}` : null,
    });
  }

  for (const event of timeline.activity ?? []) {
    const summary = (event.summary ?? "").trim();
    const title = humanize(event.type) || "Activity";
    if (!summary && !event.type) continue;

    entries.push({
      id: `activity:${event.id ?? `${event.datetime}:${title}`}`,
      kind: "activity",
      at: isoOrNull(event.datetime),
      title,
      body: summary || null,
    });
  }

  // Newest first, and anything undated sinks to the bottom rather than claiming
  // to be the most recent thing that happened.
  entries.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  return entries.slice(0, MAX_ENTRIES);
}

function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Leadflo's stage keys are camelCase and a couple of them do not survive being
 * split on capitals, so those are named outright.
 */
const STAGE_LABELS: Record<string, string> = {
  newlead: "New lead",
  intx: "In treatment",
  maybefuture: "Maybe future",
  wrongnumber: "Wrong number",
  notinterested: "Not interested",
};

function stageLabel(stage: string | null | undefined): string | null {
  const key = (stage ?? "").trim();
  if (!key) return null;
  return STAGE_LABELS[key.toLowerCase()] ?? humanize(key);
}

/** "form_submission" and "callback1" both become something readable. */
function humanize(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";

  const spaced = raw
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .toLowerCase()
    .trim();

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

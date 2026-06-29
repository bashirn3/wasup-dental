import { mockDentalDashboardData, treatmentLabels } from "@/lib/dental-demo-data";
import type {
  DentalDashboardData,
  DentalIntegration,
  DentalLead,
  DentalMessage,
  DentalWorkflow,
  SourceSystem,
  TreatmentKey,
} from "@/lib/dental-types";
import { supabaseAdmin } from "@/lib/supabase";

type SupabaseResult<T> = {
  data: T | null;
  error: { message: string; code?: string } | null;
  count?: number | null;
};

type PracticeRow = {
  id: string;
  name: string;
  website_url: string | null;
  location: string | null;
  phone: string | null;
  source_system: SourceSystem | null;
  whatsapp_status: string | null;
  connected_number: string | null;
  wasup_instance_id: string | null;
};

type LeadRow = {
  id: string;
  practice_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  treatment: string | null;
  status: string;
  source: string;
  source_system: SourceSystem | null;
  box_name: string | null;
  box_stage: string | null;
  needs_human: boolean | null;
  ai_confidence: number | null;
  last_synced_at: string | null;
  updated_at: string;
  external_payload: JsonRecord | null;
};

type JsonRecord = Record<string, unknown>;

type MessageRow = {
  id: string;
  lead_id: string | null;
  direction: "inbound" | "outbound";
  body: string;
  ai_generated: boolean | null;
  created_at: string;
};

type IntegrationRow = {
  id: string;
  source_system: SourceSystem;
  display_name: string;
  status: string;
  mode: string;
  last_synced_at: string | null;
};

type WorkflowRow = {
  id: string;
  workflow_type: string;
  template_key: string;
  display_name: string;
  mode: string;
  status: string;
  active: boolean;
  launch_ready: boolean;
  webhook_path: string | null;
};

const treatmentKeys = Object.keys(treatmentLabels) as TreatmentKey[];
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export type DentalDashboardQuery = {
  limit?: number;
  offset?: number;
  q?: string | null;
  status?: string | null;
  box?: string | null;
  stage?: string | null;
};

export async function getDentalDashboardData(
  practiceId: string | null,
  options: DentalDashboardQuery = {},
): Promise<DentalDashboardData> {
  const supabase = supabaseAdmin();
  if (!supabase || !practiceId || practiceId === "mock-practice") return mockDentalDashboardData;
  const limit = clampLimit(options.limit);
  const offset = Math.max(0, Number.isFinite(options.offset ?? 0) ? Number(options.offset ?? 0) : 0);
  const search = cleanFilter(options.q);
  const statusFilter = cleanFilter(options.status);
  const boxFilter = cleanFilter(options.box);
  const stageFilter = cleanFilter(options.stage);

  const { data: practice } = (await supabase
    .from("practices")
    .select(
      "id, name, website_url, location, phone, source_system, whatsapp_status, connected_number, wasup_instance_id",
    )
    .eq("id", practiceId)
    .maybeSingle()) as SupabaseResult<PracticeRow>;

  if (!practice) return { ...mockDentalDashboardData, practiceId, source: "mock" };

  let leadQuery = supabase
    .from("leads")
    .select(
      "id, practice_id, name, phone, email, treatment, status, source, source_system, box_name, box_stage, needs_human, ai_confidence, last_synced_at, updated_at, external_payload",
      { count: "exact" },
    )
    .eq("practice_id", practiceId);

  if (search) {
    leadQuery = leadQuery.or(
      `name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%,box_name.ilike.%${search}%,box_stage.ilike.%${search}%`,
    );
  }
  if (statusFilter) leadQuery = leadQuery.eq("status", statusFilter);
  if (boxFilter) leadQuery = leadQuery.eq("box_name", boxFilter);
  if (stageFilter) leadQuery = leadQuery.eq("box_stage", stageFilter);

  const { data: leads, count: filteredLeadTotal } = (await leadQuery
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1)) as SupabaseResult<LeadRow[]>;

  const leadRows = leads ?? [];
  const leadIds = leadRows.map((lead) => lead.id);
  const { data: messages } = leadIds.length
    ? ((await supabase
        .from("messages")
        .select("id, lead_id, direction, body, ai_generated, created_at")
        .in("lead_id", leadIds)
        .order("created_at", { ascending: true })
        .limit(5000)) as SupabaseResult<MessageRow[]>)
    : ({ data: [], error: null } as SupabaseResult<MessageRow[]>);

  const { data: integrations } = (await supabase
    .from("integrations")
    .select("id, source_system, display_name, status, mode, last_synced_at")
    .eq("practice_id", practiceId)
    .order("created_at", { ascending: true })) as SupabaseResult<IntegrationRow[]>;

  const { data: workflows } = (await supabase
    .from("workflow_provisionings")
    .select("id, workflow_type, template_key, display_name, mode, status, active, launch_ready, webhook_path")
    .eq("practice_id", practiceId)
    .order("created_at", { ascending: true })) as SupabaseResult<WorkflowRow[]>;

  const [leadTotal, aiActioned, needsHuman, booked, facets, activityRowsResult] = await Promise.all([
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("practice_id", practiceId),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("practice_id", practiceId)
      .eq("status", "engaged"),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("practice_id", practiceId)
      .eq("needs_human", true),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("practice_id", practiceId)
      .eq("status", "booked"),
    supabase
      .from("leads")
      .select(
        "id, practice_id, name, phone, email, treatment, status, source, source_system, box_name, box_stage, needs_human, ai_confidence, last_synced_at, updated_at, external_payload",
      )
      .eq("practice_id", practiceId)
      .limit(10000),
    supabase
      .from("leads")
      .select(
        "id, practice_id, name, phone, email, treatment, status, source, source_system, box_name, box_stage, needs_human, ai_confidence, last_synced_at, updated_at, external_payload",
      )
      .eq("practice_id", practiceId)
      .in("status", ["engaged", "booked"])
      .limit(1000),
  ]);

  const messageRows = messages ?? [];
  const mappedIntegrations = (integrations ?? []).map(mapIntegration);
  const allLeadRows = (facets.data ?? []) as LeadRow[];
  const activityRowsRaw = (activityRowsResult.data ?? []) as LeadRow[];
  // "When our agent last messaged them" is the source of truth for Activity order.
  const lastOutboundByLead = await fetchLastOutboundByLead(
    supabase,
    practiceId,
    activityRowsRaw.map((lead) => lead.id),
  );
  const activityRows = [...activityRowsRaw].sort((a, b) =>
    compareActivityDesc(activityOrderKey(a, lastOutboundByLead), activityOrderKey(b, lastOutboundByLead)),
  );

  return {
    source: "supabase",
    practiceId,
    practice: {
      id: practice.id,
      name: practice.name,
      websiteUrl: practice.website_url,
      location: practice.location,
      phone: practice.phone,
      sourceSystem: practice.source_system ?? "native",
      whatsappStatus: practice.whatsapp_status,
      connectedNumber: practice.connected_number,
      wasupInstanceId: practice.wasup_instance_id,
    },
    metrics: {
      leadTotal: leadTotal.count ?? filteredLeadTotal ?? leadRows.length,
      filteredLeadTotal: filteredLeadTotal ?? leadRows.length,
      loadedLeadCount: leadRows.length,
      aiActionedTotal: aiActioned.count ?? leadRows.filter((lead) => lead.status === "engaged").length,
      needsHumanTotal: needsHuman.count ?? leadRows.filter((lead) => lead.needs_human).length,
      bookedTotal: booked.count ?? leadRows.filter((lead) => lead.status === "booked").length,
      clientRepliedTotal: allLeadRows.filter((lead) => extractLeadMeta(lead).clientReplied).length,
      urgentTotal: allLeadRows.filter((lead) => (extractLeadMeta(lead).urgency ?? "").toLowerCase() === "urgent").length,
      reactivationTotal: allLeadRows.filter(
        (lead) => (extractLeadMeta(lead).urgency ?? "").toLowerCase() === "reactivation",
      ).length,
      todayTotal: allLeadRows.filter((lead) => {
        const becameLeadAt = extractLeadMeta(lead).becameLeadAt;
        if (!becameLeadAt) return false;
        const ts = new Date(becameLeadAt).getTime();
        if (Number.isNaN(ts)) return false;
        const dayStart = new Date();
        dayStart.setHours(0, 0, 0, 0);
        return ts >= dayStart.getTime();
      }).length,
    },
    pageInfo: {
      limit,
      offset,
      hasMore: offset + leadRows.length < (filteredLeadTotal ?? leadRows.length),
    },
    facets: buildFacets(allLeadRows),
    laneSummary: buildLaneSummary(allLeadRows),
    analytics: buildAnalytics(allLeadRows),
    leads: leadRows.map((lead) => mapLead(lead, messageRows)),
    activityLeads: buildActivityLeads(activityRows, lastOutboundByLead),
    integrations: withExpectedIntegrations(mappedIntegrations),
    workflows: (workflows ?? []).map(mapWorkflow),
    activity: buildActivity(activityRows, messageRows, lastOutboundByLead),
    sourceHealth: buildSourceHealth(mappedIntegrations),
  };
}

function clampLimit(value: number | undefined) {
  if (!Number.isFinite(value ?? NaN)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Number(value), 1), MAX_LIMIT);
}

function cleanFilter(value: string | null | undefined) {
  const cleaned = String(value ?? "")
    .replace(/[%*,()]/g, "")
    .trim();
  return cleaned || null;
}

function buildFacets(rows: Array<{ box_name?: string | null; box_stage?: string | null; status?: string | null }>) {
  const boxes = new Set<string>();
  const stages = new Set<string>();
  const statuses = new Set<string>();
  for (const row of rows) {
    if (row.box_name) boxes.add(row.box_name);
    if (row.box_stage) stages.add(row.box_stage);
    if (row.status) statuses.add(row.status);
  }
  return {
    boxes: [...boxes].sort(),
    stages: [...stages].sort(),
    statuses: [...statuses].sort(),
  };
}

function buildLaneSummary(
  rows: Array<{
    box_name?: string | null;
    status?: string | null;
    needs_human?: boolean | null;
    external_payload?: JsonRecord | null;
  }>,
) {
  const byLane = new Map<
    string,
    { name: string; total: number; needsHuman: number; aiActioned: number; booked: number }
  >();

  for (const row of rows) {
    const name = row.box_name || "Unassigned";
    const current = byLane.get(name) ?? {
      name,
      total: 0,
      needsHuman: 0,
      aiActioned: 0,
      booked: 0,
    };
    current.total += 1;
    const meta = extractLeadMeta(row);
    if (row.needs_human) current.needsHuman += 1;
    if (meta.aiActioned || row.status === "engaged") current.aiActioned += 1;
    if (row.status === "booked") current.booked += 1;
    byLane.set(name, current);
  }

  return [...byLane.values()].sort((a, b) => b.total - a.total).slice(0, 12);
}

function occurredKey(row: LeadRow): string | null {
  const meta = extractLeadMeta(row);
  return meta.actionedAt ?? meta.aiActionedAt ?? meta.becameLeadAt ?? row.updated_at ?? null;
}

function buildAnalytics(rows: LeadRow[]): DentalDashboardData["analytics"] {
  const byTreatment = new Map<
    TreatmentKey,
    { key: TreatmentKey; label: string; total: number; aiActioned: number; booked: number }
  >();
  const bySource = new Map<string, { source: string; total: number; clientReplied: number }>();
  const byDay = new Map<string, { label: string; total: number; aiActioned: number; clientReplied: number }>();
  const reactivation = { contacted: 0, responded: 0, booked: 0 };
  const attention: LeadRow[] = [];

  for (const row of rows) {
    const meta = extractLeadMeta(row);
    const urgency = (meta.urgency ?? "").toLowerCase();
    const responded = meta.aiActioned && meta.clientReplied;
    const booked = row.status === "booked";

    if (urgency === "reactivation") {
      if (meta.aiActioned) reactivation.contacted += 1;
      if (responded) reactivation.responded += 1;
      if (booked) reactivation.booked += 1;
    }
    if (urgency === "urgent" || urgency === "reactivation") attention.push(row);

    const treatment = normalizeTreatment(row.treatment ?? null);
    const treatmentSummary = byTreatment.get(treatment) ?? {
      key: treatment,
      label: treatmentLabels[treatment],
      total: 0,
      aiActioned: 0,
      booked: 0,
    };
    treatmentSummary.total += 1;
    if (meta.aiActioned || row.status === "engaged") treatmentSummary.aiActioned += 1;
    if (row.status === "booked") treatmentSummary.booked += 1;
    byTreatment.set(treatment, treatmentSummary);

    const source = row.source || "boxly";
    const sourceSummary = bySource.get(source) ?? { source, total: 0, clientReplied: 0 };
    sourceSummary.total += 1;
    if (meta.clientReplied) sourceSummary.clientReplied += 1;
    bySource.set(source, sourceSummary);

    const timelineDate = meta.aiActionedAt ?? meta.actionedAt ?? meta.lastUpdatedAt ?? row.updated_at;
    if (timelineDate) {
      const date = new Date(timelineDate);
      if (!Number.isNaN(date.getTime())) {
        const key = date.toISOString().slice(0, 10);
        const label = date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
        const day = byDay.get(key) ?? { label, total: 0, aiActioned: 0, clientReplied: 0 };
        day.total += 1;
        if (meta.aiActioned || row.status === "engaged") day.aiActioned += 1;
        if (meta.clientReplied) day.clientReplied += 1;
        byDay.set(key, day);
      }
    }
  }

  const needsAttention = attention
    .sort((a, b) => compareActivityDesc(occurredKey(a), occurredKey(b)))
    .slice(0, 10)
    .map((row) => ({
      id: row.id,
      name: row.name ?? "Unknown patient",
      phone: row.phone,
      treatment: normalizeTreatment(row.treatment ?? null),
      urgency: extractLeadMeta(row).urgency,
      occurredAt: occurredKey(row),
    }));

  return {
    treatmentBreakdown: [...byTreatment.values()].sort((a, b) => b.total - a.total).slice(0, 8),
    sourceBreakdown: [...bySource.values()].sort((a, b) => b.total - a.total).slice(0, 8),
    timeline: [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-30)
      .map(([, value]) => value),
    reactivation,
    needsAttention,
  };
}

function mapLead(lead: LeadRow, allMessages: MessageRow[], lastOutboundAt?: string | null): DentalLead {
  const meta = extractLeadMeta(lead);
  const messages = allMessages
    .filter((message) => message.lead_id === lead.id)
    .map(mapMessage);
  const lastMessage = messages.at(-1)?.body ?? meta.leadSummary ?? lead.box_stage ?? lead.status;
  const lastOutbound =
    lastOutboundAt ?? [...messages].reverse().find((m) => m.direction === "outbound")?.createdAt ?? null;

  return {
    id: lead.id,
    practiceId: lead.practice_id,
    name: lead.name ?? "Unknown patient",
    phone: lead.phone ?? "",
    email: lead.email,
    treatment: normalizeTreatment(lead.treatment),
    status: normalizeStatus(lead.status),
    source: lead.source,
    sourceSystem: lead.source_system ?? "native",
    boxName: lead.box_name,
    boxStage: lead.box_stage,
    needsHuman: Boolean(lead.needs_human),
    aiConfidence: lead.ai_confidence,
    aiActioned: meta.aiActioned,
    actioned: meta.actioned,
    clientReplied: meta.clientReplied,
    unseenReplyCount: meta.unseenReplyCount,
    conversationCount: meta.conversationCount,
    leadSummary: meta.leadSummary,
    urgency: meta.urgency,
    actionedNote: meta.actionedNote,
    entryPoint: meta.entryPoint,
    actionedAt: meta.actionedAt,
    aiActionedAt: meta.aiActionedAt,
    becameLeadAt: meta.becameLeadAt,
    lastUpdatedAt: meta.lastUpdatedAt,
    scrapedAt: meta.scrapedAt,
    lastSyncedAt: lead.last_synced_at,
    updatedAt: lead.updated_at,
    lastOutboundAt: lastOutbound,
    lastMessage,
    messages,
  };
}

function mapMessage(message: MessageRow): DentalMessage {
  return {
    id: message.id,
    direction: message.direction,
    body: message.body,
    aiGenerated: Boolean(message.ai_generated),
    createdAt: message.created_at,
  };
}

function mapIntegration(row: IntegrationRow): DentalIntegration {
  return {
    id: row.id,
    sourceSystem: row.source_system,
    displayName: row.display_name,
    status: normalizeIntegrationStatus(row.status),
    mode: row.mode === "hybrid" || row.mode === "native" || row.mode === "legacy_mirror" ? row.mode : "disabled",
    lastSyncedAt: row.last_synced_at,
    healthLabel: row.last_synced_at ? `Synced ${relativeTime(row.last_synced_at)}` : "Not synced",
  };
}

function mapWorkflow(row: WorkflowRow): DentalWorkflow {
  return {
    id: row.id,
    workflowType: row.workflow_type,
    templateKey: row.template_key,
    displayName: row.display_name,
    mode: row.mode,
    status: row.status,
    active: row.active,
    launchReady: row.launch_ready,
    webhookPath: row.webhook_path,
  };
}

function withExpectedIntegrations(integrations: DentalIntegration[]): DentalIntegration[] {
  const expected: Array<[SourceSystem, string]> = [
    ["boxly", "Boxly lanes"],
    ["dentally", "Dentally booking"],
    ["stripe", "Stripe Connect"],
  ];

  return expected.map(([sourceSystem, displayName]) => {
    const existing = integrations.find((integration) => integration.sourceSystem === sourceSystem);
    return (
      existing ?? {
        id: `missing-${sourceSystem}`,
        sourceSystem,
        displayName,
        status: "missing",
        mode: "disabled",
        lastSyncedAt: null,
        healthLabel: "Not connected",
      }
    );
  });
}

function buildActivityLeads(leads: LeadRow[], lastOutboundByLead: Map<string, string>): DentalLead[] {
  return leads
    .filter((lead) => {
      const meta = extractLeadMeta(lead);
      return meta.actioned || meta.aiActioned || lead.status === "engaged" || lead.status === "booked";
    })
    .sort((a, b) => compareActivityDesc(activityOrderKey(a, lastOutboundByLead), activityOrderKey(b, lastOutboundByLead)))
    .slice(0, 200)
    .map((lead) => mapLead(lead, [], lastOutboundByLead.get(lead.id) ?? null));
}

function buildActivity(
  leads: LeadRow[],
  messages: MessageRow[],
  lastOutboundByLead: Map<string, string>,
): DentalDashboardData["activity"] {
  return leads
    .filter((lead) => {
      const meta = extractLeadMeta(lead);
      return meta.actioned || meta.aiActioned || lead.status === "engaged" || lead.status === "booked";
    })
    .sort((a, b) => compareActivityDesc(activityOrderKey(a, lastOutboundByLead), activityOrderKey(b, lastOutboundByLead)))
    .map((lead) => {
      const meta = extractLeadMeta(lead);
      const latestMessage = messages
        .filter((message) => message.lead_id === lead.id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      const occurredAt =
        activityOrderKey(lead, lastOutboundByLead) ??
        latestMessage?.created_at ??
        lead.updated_at;
      const title = lead.needs_human
        ? "Needs staff review"
        : meta.clientReplied
          ? "Patient replied"
          : meta.aiActioned
            ? "AI actioned"
            : lead.status === "booked"
              ? "Booked"
              : "Lead updated";
      const summary = meta.leadSummary ?? latestMessage?.body ?? `${lead.box_name ?? "Lead"} / ${lead.box_stage ?? lead.status}`;

      return {
        id: `lead-activity-${lead.id}`,
        title,
        description: `${lead.name ?? "Patient"}: ${summary.slice(0, 160)}`,
        createdAt: relativeTime(occurredAt),
        occurredAt,
        leadId: lead.id,
        patientName: lead.name ?? "Unknown patient",
        treatment: normalizeTreatment(lead.treatment),
        lane: lead.box_name,
        stage: lead.box_stage,
        leadSummary: meta.leadSummary,
        actionedNote: meta.actionedNote,
        aiActioned: meta.aiActioned,
        clientReplied: meta.clientReplied,
        needsHuman: Boolean(lead.needs_human),
        conversationCount: meta.conversationCount,
      };
    })
    .slice(0, 30);
}

/**
 * Activity is ordered by when our agent last messaged the patient.
 * Truth order: last outbound message -> actioned_at (matches Boxly's
 * `order by actioned_at desc nulls last`). We intentionally do NOT fall back to
 * ai_actioned_at, updated_at, or scraped_at: ai_actioned_at diverges from Boxly's
 * order, and updated_at/scraped_at are stamped at import time (which floats stale
 * /test leads to the top). Leads with neither sort LAST.
 */
function activityOrderKey(lead: LeadRow, lastOutboundByLead: Map<string, string>): string | null {
  const meta = extractLeadMeta(lead);
  return lastOutboundByLead.get(lead.id) ?? meta.actionedAt ?? null;
}

/** Descending sort with nulls last. */
function compareActivityDesc(a: string | null, b: string | null): number {
  if (a && b) return b.localeCompare(a);
  if (a) return -1;
  if (b) return 1;
  return 0;
}

/**
 * Map of lead_id -> latest outbound message timestamp for the given leads.
 * Uses the `lead_last_outbound` view (one grouped row per lead) when present.
 * Degrades gracefully to an empty map if the view is not yet migrated, in which
 * case ordering falls back to actioned_at (still correct, just Boxly-equivalent).
 */
async function fetchLastOutboundByLead(
  supabase: NonNullable<ReturnType<typeof supabaseAdmin>>,
  practiceId: string,
  leadIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!leadIds.length) return result;

  for (let i = 0; i < leadIds.length; i += 300) {
    const chunk = leadIds.slice(i, i + 300);
    const { data, error } = (await supabase
      .from("lead_last_outbound")
      .select("lead_id, last_outbound_at")
      .eq("practice_id", practiceId)
      .in("lead_id", chunk)) as SupabaseResult<{ lead_id: string; last_outbound_at: string | null }[]>;
    if (error) return result; // view missing or unreadable -> fall back to actioned_at ordering
    for (const row of data ?? []) {
      if (row.lead_id && row.last_outbound_at) result.set(row.lead_id, row.last_outbound_at);
    }
  }
  return result;
}

function buildSourceHealth(integrations: DentalIntegration[]): DentalDashboardData["sourceHealth"] {
  const synced = integrations.filter((integration) => integration.lastSyncedAt);
  if (!synced.length) {
    return {
      status: "not_synced",
      label: "No synced source yet",
      detail: "Connect Boxly, Dentally, or import CSV leads to fill this dashboard.",
      lastSyncedAt: null,
    };
  }

  const newest = synced
    .map((integration) => integration.lastSyncedAt)
    .filter(Boolean)
    .sort()
    .at(-1)!;
  const ageMinutes = (Date.now() - new Date(newest).getTime()) / 60_000;

  return {
    status: ageMinutes <= 10 ? "fresh" : "stale",
    label: ageMinutes <= 10 ? "Source fresh" : "Source stale",
    detail: `Latest connector update was ${relativeTime(newest)}.`,
    lastSyncedAt: newest,
  };
}

function extractLeadMeta(row: { status?: string | null; external_payload?: JsonRecord | null }) {
  const payload = recordValue(row.external_payload);
  const legacy = recordValue(payload.legacy);
  const raw = recordValue(payload.raw);
  const linkedLeads = Array.isArray(raw.linked_leads) ? raw.linked_leads : [];
  const firstLinkedLead = recordValue(linkedLeads.find((item) => isRecord(item)));
  const aiActioned = boolValue(legacy.aiActioned) || boolValue(legacy.ai_actioned) || row.status === "engaged";
  const actioned =
    boolValue(legacy.actioned) ||
    Boolean(stringValue(legacy.actionedAt) ?? stringValue(legacy.actioned_at)) ||
    aiActioned;

  return {
    aiActioned,
    actioned,
    clientReplied:
      boolValue(raw.client_replied) ||
      boolValue(raw.clientReplied) ||
      Boolean(numberValue(raw.unseen_reply_count)),
    unseenReplyCount: numberValue(raw.unseen_reply_count) ?? 0,
    conversationCount:
      numberValue(legacy.conversationCount) ??
      numberValue(legacy.conversation_count) ??
      numberValue(raw.conversation_count) ??
      0,
    leadSummary:
      stringValue(payload.summary) ??
      stringValue(raw.lead_summary) ??
      stringValue(firstLinkedLead.lead_summary),
    urgency: stringValue(legacy.urgency) ?? stringValue(raw.urgency),
    actionedNote:
      stringValue(legacy.actionedNote) ??
      stringValue(legacy.actioned_note) ??
      stringValue(raw.actioned_note) ??
      stringValue(raw.actionedNote),
    entryPoint: stringValue(raw.entry_point) ?? stringValue(raw.entryPoint),
    actionedAt: stringValue(legacy.actionedAt) ?? stringValue(legacy.actioned_at),
    aiActionedAt: stringValue(legacy.aiActionedAt) ?? stringValue(legacy.ai_actioned_at),
    becameLeadAt: stringValue(legacy.becameLeadAt) ?? stringValue(legacy.became_lead_at),
    lastUpdatedAt: stringValue(legacy.lastUpdatedAt) ?? stringValue(legacy.last_updated_at),
    scrapedAt: stringValue(legacy.scrapedAt) ?? stringValue(legacy.scraped_at),
  };
}

function recordValue(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boolValue(value: unknown): boolean {
  return value === true || value === "true";
}

function normalizeTreatment(value: string | null): TreatmentKey {
  return treatmentKeys.includes(value as TreatmentKey) ? (value as TreatmentKey) : "invisalign";
}

function normalizeStatus(value: string): DentalLead["status"] {
  if (["new", "engaged", "qualified", "staff_review", "booked", "closed"].includes(value)) {
    return value as DentalLead["status"];
  }
  return "new";
}

function normalizeIntegrationStatus(value: string): DentalIntegration["status"] {
  if (["draft", "connected", "paused", "error", "missing"].includes(value)) {
    return value as DentalIntegration["status"];
  }
  return "draft";
}

export function relativeTime(value: string): string {
  const diffMs = Date.now() - new Date(value).getTime();
  const mins = Math.max(0, Math.round(diffMs / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} day ago`;
}

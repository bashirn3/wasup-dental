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
};

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

export async function getDentalDashboardData(
  practiceId: string | null,
): Promise<DentalDashboardData> {
  const supabase = supabaseAdmin();
  if (!supabase || !practiceId || practiceId === "mock-practice") return mockDentalDashboardData;

  const { data: practice } = (await supabase
    .from("practices")
    .select(
      "id, name, website_url, location, phone, source_system, whatsapp_status, connected_number, wasup_instance_id",
    )
    .eq("id", practiceId)
    .maybeSingle()) as SupabaseResult<PracticeRow>;

  if (!practice) return { ...mockDentalDashboardData, practiceId, source: "mock" };

  const { data: leads, count: leadTotal } = (await supabase
    .from("leads")
    .select(
      "id, practice_id, name, phone, treatment, status, source, source_system, box_name, box_stage, needs_human, ai_confidence, last_synced_at, updated_at",
      { count: "exact" },
    )
    .eq("practice_id", practiceId)
    .order("updated_at", { ascending: false })
    .limit(1000)) as SupabaseResult<LeadRow[]>;

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

  const [aiActioned, needsHuman, booked] = await Promise.all([
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
  ]);

  const messageRows = messages ?? [];
  const mappedIntegrations = (integrations ?? []).map(mapIntegration);

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
      leadTotal: leadTotal ?? leadRows.length,
      loadedLeadCount: leadRows.length,
      aiActionedTotal: aiActioned.count ?? leadRows.filter((lead) => lead.status === "engaged").length,
      needsHumanTotal: needsHuman.count ?? leadRows.filter((lead) => lead.needs_human).length,
      bookedTotal: booked.count ?? leadRows.filter((lead) => lead.status === "booked").length,
    },
    leads: leadRows.map((lead) => mapLead(lead, messageRows)),
    integrations: withExpectedIntegrations(mappedIntegrations),
    workflows: (workflows ?? []).map(mapWorkflow),
    activity: buildActivity(leadRows, messageRows),
    sourceHealth: buildSourceHealth(mappedIntegrations),
  };
}

function mapLead(lead: LeadRow, allMessages: MessageRow[]): DentalLead {
  const messages = allMessages
    .filter((message) => message.lead_id === lead.id)
    .map(mapMessage);
  const lastMessage = messages.at(-1)?.body ?? lead.box_stage ?? lead.status;

  return {
    id: lead.id,
    practiceId: lead.practice_id,
    name: lead.name ?? "Unknown patient",
    phone: lead.phone ?? "",
    treatment: normalizeTreatment(lead.treatment),
    status: normalizeStatus(lead.status),
    source: lead.source,
    sourceSystem: lead.source_system ?? "native",
    boxName: lead.box_name,
    boxStage: lead.box_stage,
    needsHuman: Boolean(lead.needs_human),
    aiConfidence: lead.ai_confidence,
    lastSyncedAt: lead.last_synced_at,
    updatedAt: lead.updated_at,
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

function buildActivity(leads: LeadRow[], messages: MessageRow[]): DentalDashboardData["activity"] {
  const messageActivity = messages
    .slice(-8)
    .reverse()
    .map((message) => {
      const lead = leads.find((item) => item.id === message.lead_id);
      return {
        id: message.id,
        title: message.direction === "inbound" ? "Patient replied" : message.ai_generated ? "AI sent message" : "Message sent",
        description: `${lead?.name ?? "Patient"}: ${message.body.slice(0, 120)}`,
        createdAt: relativeTime(message.created_at),
      };
    });

  if (messageActivity.length) return messageActivity;

  return leads.slice(0, 5).map((lead) => ({
    id: lead.id,
    title: lead.needs_human ? "Needs staff review" : lead.status === "booked" ? "Booked" : "Lead updated",
    description: `${lead.name ?? "Patient"} in ${lead.box_name ?? "lead source"} / ${lead.box_stage ?? lead.status}`,
    createdAt: relativeTime(lead.updated_at),
  }));
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

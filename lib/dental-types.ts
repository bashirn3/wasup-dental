export type Role = "admin" | "client";

export type SourceSystem =
  | "native"
  | "boxly"
  | "regent"
  | "nuyu"
  | "dentally"
  | "stripe"
  | "wasup"
  | "n8n"
  | "csv"
  | "manual";

export type IntegrationStatus = "missing" | "draft" | "connected" | "paused" | "error";

export type TreatmentKey =
  | "invisalign"
  | "implants"
  | "full_arch_implants"
  | "composites"
  | "whitening"
  | "veneers"
  | "hygiene"
  | "emergency";

export type LeadStatus =
  | "new"
  | "engaged"
  | "qualified"
  | "staff_review"
  | "booked"
  | "closed";

export type DentalMessage = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  aiGenerated: boolean;
  // Original sender label from the source system (e.g. "Reception Team",
  // a staff member's name, or the client). Mirrors Boxly's per-message sender.
  sender?: string | null;
  // Source message type: "outbound" | "inbound" | "system" | "form_submission" | ...
  kind?: string | null;
  createdAt: string;
};

export type DentalLead = {
  id: string;
  practiceId: string;
  name: string;
  phone: string;
  email: string | null;
  treatment: TreatmentKey;
  status: LeadStatus;
  source: string;
  sourceSystem: SourceSystem;
  boxName: string | null;
  boxStage: string | null;
  needsHuman: boolean;
  aiConfidence: number | null;
  aiActioned: boolean;
  actioned: boolean;
  clientReplied: boolean;
  unseenReplyCount: number;
  conversationCount: number;
  leadSummary: string | null;
  urgency: string | null;
  actionedNote: string | null;
  entryPoint: string | null;
  actionedAt: string | null;
  aiActionedAt: string | null;
  becameLeadAt: string | null;
  lastUpdatedAt: string | null;
  scrapedAt: string | null;
  lastSyncedAt: string | null;
  updatedAt: string;
  lastOutboundAt: string | null;
  lastMessage: string;
  messages: DentalMessage[];
};

export type DentalPractice = {
  id: string;
  name: string;
  websiteUrl: string | null;
  location: string | null;
  phone: string | null;
  sourceSystem: SourceSystem;
  whatsappStatus: string | null;
  connectedNumber: string | null;
  wasupInstanceId: string | null;
};

export type DentalWorkspace = {
  id: string;
  name: string;
  role: Role;
  sourceSystem: SourceSystem;
  integrationMode: string;
};

export type DentalIntegration = {
  id: string;
  sourceSystem: SourceSystem;
  displayName: string;
  status: IntegrationStatus;
  mode: "legacy_mirror" | "native" | "hybrid" | "disabled";
  lastSyncedAt: string | null;
  healthLabel: string;
};

export type DentalWorkflow = {
  id: string;
  workflowType: string;
  templateKey: string;
  displayName: string;
  mode: string;
  status: string;
  active: boolean;
  launchReady: boolean;
  webhookPath: string | null;
};

export type DentalDashboardData = {
  source: "mock" | "supabase";
  practiceId: string | null;
  practice: DentalPractice | null;
  workspaces?: DentalWorkspace[];
  role?: Role;
  metrics?: {
    leadTotal: number;
    filteredLeadTotal?: number;
    loadedLeadCount: number;
    aiActionedTotal: number;
    needsHumanTotal: number;
    bookedTotal: number;
    clientRepliedTotal?: number;
    urgentTotal?: number;
    reactivationTotal?: number;
    todayTotal?: number;
  };
  pageInfo?: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  facets?: {
    boxes: string[];
    stages: string[];
    statuses: string[];
  };
  laneSummary?: {
    name: string;
    total: number;
    needsHuman: number;
    aiActioned: number;
    booked: number;
  }[];
  analytics?: {
    treatmentBreakdown: {
      key: TreatmentKey;
      label: string;
      total: number;
      aiActioned: number;
      booked: number;
    }[];
    sourceBreakdown: {
      source: string;
      total: number;
      clientReplied: number;
    }[];
    timeline: {
      label: string;
      total: number;
      aiActioned: number;
      clientReplied: number;
    }[];
    reactivation?: {
      contacted: number;
      responded: number;
      booked: number;
    };
    needsAttention?: {
      id: string;
      name: string;
      phone: string | null;
      treatment: TreatmentKey;
      urgency: string | null;
      occurredAt: string | null;
    }[];
  };
  leads: DentalLead[];
  activityLeads?: DentalLead[];
  integrations: DentalIntegration[];
  workflows: DentalWorkflow[];
  activity: {
    id: string;
    title: string;
    description: string;
    createdAt: string;
    occurredAt?: string | null;
    leadId?: string;
    patientName?: string;
    treatment?: TreatmentKey;
    lane?: string | null;
    stage?: string | null;
    leadSummary?: string | null;
    actionedNote?: string | null;
    aiActioned?: boolean;
    clientReplied?: boolean;
    needsHuman?: boolean;
    conversationCount?: number;
  }[];
  sourceHealth: {
    status: "mock" | "native" | "fresh" | "stale" | "not_synced";
    label: string;
    detail: string;
    lastSyncedAt: string | null;
  };
};

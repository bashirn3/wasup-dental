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
  createdAt: string;
};

export type DentalLead = {
  id: string;
  practiceId: string;
  name: string;
  phone: string;
  treatment: TreatmentKey;
  status: LeadStatus;
  source: string;
  sourceSystem: SourceSystem;
  boxName: string | null;
  boxStage: string | null;
  needsHuman: boolean;
  aiConfidence: number | null;
  lastSyncedAt: string | null;
  updatedAt: string;
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
    loadedLeadCount: number;
    aiActionedTotal: number;
    needsHumanTotal: number;
    bookedTotal: number;
  };
  leads: DentalLead[];
  integrations: DentalIntegration[];
  workflows: DentalWorkflow[];
  activity: {
    id: string;
    title: string;
    description: string;
    createdAt: string;
  }[];
  sourceHealth: {
    status: "mock" | "native" | "fresh" | "stale" | "not_synced";
    label: string;
    detail: string;
    lastSyncedAt: string | null;
  };
};

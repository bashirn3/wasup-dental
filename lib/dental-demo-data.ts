import type { DentalDashboardData, DentalLead, TreatmentKey } from "@/lib/dental-types";

export const treatmentLabels: Record<TreatmentKey, string> = {
  invisalign: "Invisalign",
  implants: "Implants",
  full_arch_implants: "Full arch implants",
  composites: "Composite bonding",
  whitening: "Whitening",
  veneers: "Veneers",
  hygiene: "Hygiene",
  emergency: "Emergency",
};

export const defaultAgentPrompt = `You are the WhatsApp assistant for a dental practice.

Stay warm, concise, and practical. Qualify the patient, answer from the approved knowledge, and move toward a consultation only when it is appropriate.

Do not diagnose. Do not guarantee treatment, price, finance approval, or clinical outcomes. Escalate complaints, medical uncertainty, pricing disputes, and anything sensitive to staff.`;

export const defaultFirstMessage =
  "Hi {{first_name}}, it is {{practice_name}}. We noticed you were interested in {{treatment}}. Would you like me to help you find a suitable consultation slot?";

const now = Date.now();
const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

export const mockDentalLeads: DentalLead[] = [
  {
    id: "mock-ruth",
    practiceId: "mock-practice",
    name: "Ruth Derham",
    phone: "+447700900123",
    treatment: "invisalign",
    status: "engaged",
    source: "boxly",
    sourceSystem: "regent",
    boxName: "Invisalign",
    boxStage: "AI actioned",
    needsHuman: false,
    aiConfidence: 0.82,
    lastSyncedAt: minutesAgo(2),
    updatedAt: minutesAgo(3),
    lastMessage: "Tuesday after 4pm would work. How long is the consultation?",
    messages: [
      {
        id: "mock-ruth-1",
        direction: "outbound",
        body: "Hi Ruth, it is Regent Dental. Are you still interested in Invisalign?",
        aiGenerated: true,
        createdAt: minutesAgo(46),
      },
      {
        id: "mock-ruth-2",
        direction: "inbound",
        body: "Yes, I am. Tuesday after 4pm would work. How long is the consultation?",
        aiGenerated: false,
        createdAt: minutesAgo(3),
      },
    ],
  },
  {
    id: "mock-fatima",
    practiceId: "mock-practice",
    name: "Fatima Adebukola",
    phone: "+447700900456",
    treatment: "implants",
    status: "staff_review",
    source: "boxly",
    sourceSystem: "regent",
    boxName: "Implants",
    boxStage: "Needs human",
    needsHuman: true,
    aiConfidence: 0.46,
    lastSyncedAt: minutesAgo(2),
    updatedAt: minutesAgo(18),
    lastMessage: "I had implant surgery before and it went badly. Can someone call me?",
    messages: [
      {
        id: "mock-fatima-1",
        direction: "inbound",
        body: "I had implant surgery before and it went badly. Can someone call me?",
        aiGenerated: false,
        createdAt: minutesAgo(18),
      },
    ],
  },
  {
    id: "mock-james",
    practiceId: "mock-practice",
    name: "James Wilson",
    phone: "+447700900789",
    treatment: "composites",
    status: "booked",
    source: "boxly",
    sourceSystem: "regent",
    boxName: "Composite bonding",
    boxStage: "Booked",
    needsHuman: false,
    aiConfidence: 0.91,
    lastSyncedAt: minutesAgo(2),
    updatedAt: minutesAgo(55),
    lastMessage: "Great, booked for Thursday at 10:30.",
    messages: [
      {
        id: "mock-james-1",
        direction: "outbound",
        body: "We have Thursday 10:30 or Friday 14:00 for a composite bonding consultation.",
        aiGenerated: true,
        createdAt: minutesAgo(62),
      },
      {
        id: "mock-james-2",
        direction: "inbound",
        body: "Thursday 10:30 please.",
        aiGenerated: false,
        createdAt: minutesAgo(56),
      },
    ],
  },
];

export const mockDentalDashboardData: DentalDashboardData = {
  source: "mock",
  practiceId: "mock-practice",
  practice: {
    id: "mock-practice",
    name: "Regent Dental",
    websiteUrl: "https://regentdental.co.uk",
    location: "London",
    phone: "+442000000000",
    sourceSystem: "regent",
    whatsappStatus: "not_connected",
    connectedNumber: null,
    wasupInstanceId: null,
  },
  metrics: {
    leadTotal: mockDentalLeads.length,
    loadedLeadCount: mockDentalLeads.length,
    aiActionedTotal: mockDentalLeads.filter((lead) =>
      lead.messages.some((message) => message.aiGenerated),
    ).length,
    needsHumanTotal: mockDentalLeads.filter((lead) => lead.needsHuman).length,
    bookedTotal: mockDentalLeads.filter((lead) => lead.status === "booked").length,
  },
  leads: mockDentalLeads,
  integrations: [
    {
      id: "mock-boxly",
      sourceSystem: "boxly",
      displayName: "Boxly lanes",
      status: "connected",
      mode: "legacy_mirror",
      lastSyncedAt: minutesAgo(2),
      healthLabel: "Synced 2 min ago",
    },
    {
      id: "mock-dentally",
      sourceSystem: "dentally",
      displayName: "Dentally booking",
      status: "draft",
      mode: "native",
      lastSyncedAt: null,
      healthLabel: "Not connected",
    },
    {
      id: "mock-stripe",
      sourceSystem: "stripe",
      displayName: "Stripe Connect",
      status: "draft",
      mode: "native",
      lastSyncedAt: null,
      healthLabel: "Not connected",
    },
  ],
  workflows: [],
  activity: [
    {
      id: "activity-1",
      title: "Patient replied",
      description: "Ruth Derham asked about consultation length.",
      createdAt: "3 min ago",
    },
    {
      id: "activity-2",
      title: "Human review needed",
      description: "Fatima Adebukola should be called by staff.",
      createdAt: "18 min ago",
    },
    {
      id: "activity-3",
      title: "Booked",
      description: "James Wilson accepted Thursday 10:30.",
      createdAt: "55 min ago",
    },
  ],
  sourceHealth: {
    status: "mock",
    label: "Demo data",
    detail: "Connect Supabase and Boxly to mirror live practice data.",
    lastSyncedAt: null,
  },
};

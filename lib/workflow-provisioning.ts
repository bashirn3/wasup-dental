export type DentalWorkflowTemplate = {
  workflowType:
    | "lead_sync_feeder"
    | "wf1_outbound_sender"
    | "wf2_inbound_agent"
    | "booking_payment_sidecar";
  templateKey: string;
  displayName: string;
  webhookPath: string;
  sideEffects: string[];
};

export const dentalWorkflowTemplates: DentalWorkflowTemplate[] = [
  {
    workflowType: "lead_sync_feeder",
    templateKey: "dental-lead-sync-feeder-v1",
    displayName: "Lead Sync / Feeder",
    webhookPath: "/webhook/dental/lead-sync/dry-run",
    sideEffects: ["lead_cache_write"],
  },
  {
    workflowType: "wf1_outbound_sender",
    templateKey: "dental-wf1-outbound-sender-v1",
    displayName: "WF-1 Outbound Sender",
    webhookPath: "/webhook/dental/wf1/outbound/dry-run",
    sideEffects: ["wasup_send"],
  },
  {
    workflowType: "wf2_inbound_agent",
    templateKey: "dental-wf2-inbound-agent-v1",
    displayName: "WF-2 Inbound Agent",
    webhookPath: "/webhook/dental/wf2/inbound/dry-run",
    sideEffects: ["wasup_send", "crm_read"],
  },
  {
    workflowType: "booking_payment_sidecar",
    templateKey: "dental-booking-payment-sidecar-v1",
    displayName: "Booking + Payment Sidecar",
    webhookPath: "/webhook/dental/booking-payment/dry-run",
    sideEffects: ["dentally_booking_create", "stripe_payment_link_create", "wasup_send"],
  },
];

export function workflowProvisioningConfig(practiceId: string) {
  return {
    practiceId,
    mode: "dry_run",
    active: false,
    launchReady: false,
    sendAllowed: false,
    triggerAllowed: false,
    bookingAllowed: false,
    paymentAllowed: false,
    crmWriteAllowed: false,
    notes:
      "Created by Wasup Dental as inactive dry-run records. Live sends, workflow activation, provider webhook changes, bookings, payments, and CRM writes require explicit approval.",
  };
}

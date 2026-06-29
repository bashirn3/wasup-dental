"use client";

import AgentBuilder from "@/components/agent/AgentBuilder";
import { useApp } from "./context";

/** Full-screen agent editor — same UI as /agent onboarding step 1. */
export function AgentEditScreen() {
  const { tenantId, closeAgentEdit, toast } = useApp();
  return (
    <AgentBuilder
      variant="edit"
      editTenantId={tenantId}
      onClose={closeAgentEdit}
      onSaved={() => toast("Agent saved")}
    />
  );
}

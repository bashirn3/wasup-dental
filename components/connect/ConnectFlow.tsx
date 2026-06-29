"use client";

import { useEffect, useState } from "react";
import { WhatsAppConnectPanel } from "@/components/connect/WhatsAppConnectPanel";
import { ONBOARDING_DRAFT_KEY, parseOnboardingDraft, TENANT_ID_KEY } from "@/lib/onboarding-storage";

export default function ConnectFlow() {
  const [tenantId, setTenantId] = useState("");
  const [garageName, setGarageName] = useState("RapidMOT garage");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    setTenantId(localStorage.getItem(TENANT_ID_KEY) ?? "");
    try {
      const d = parseOnboardingDraft(localStorage.getItem(ONBOARDING_DRAFT_KEY));
      if (d?.place?.phone) setPhone(d.place.phone);
      if (d?.place?.name) setGarageName(d.place.name);
    } catch {
      /* fresh start */
    }
  }, []);

  if (!tenantId) return null;

  return (
    <WhatsAppConnectPanel
      tenantId={tenantId}
      garageName={garageName}
      initialPhone={phone}
      variant="page"
    />
  );
}

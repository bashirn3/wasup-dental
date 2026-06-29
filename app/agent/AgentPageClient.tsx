"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AgentBuilder from "@/components/agent/AgentBuilder";
import { authFontClassNames } from "@/lib/auth-fonts";
import { TENANT_ID_KEY } from "@/lib/onboarding-storage";

function AgentPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const edit = searchParams.get("edit") === "1";
  const tenantParam = searchParams.get("tenantId") ?? "";
  const tenantId =
    tenantParam ||
    (typeof window !== "undefined" ? localStorage.getItem(TENANT_ID_KEY) : null) ||
    "";

  const closeEdit = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/dashboard");
  };

  return (
    <div className={`${authFontClassNames} min-h-dvh`}>
      {edit && tenantId ? (
        <AgentBuilder
          variant="edit"
          editTenantId={tenantId}
          onClose={closeEdit}
        />
      ) : (
        <AgentBuilder />
      )}
    </div>
  );
}

export default function AgentPageClient() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center bg-[#0B241C] text-[#9DB3A7]">
          Loading…
        </main>
      }
    >
      <AgentPageInner />
    </Suspense>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import DashboardShell from "@/components/dashboard/DashboardShell";
import {
  isCompleteOnboardingDraft,
  ONBOARDING_DRAFT_KEY,
  ONBOARDING_SYNCED_TENANT_KEY,
  ONBOARDING_STEP_KEY,
  parseOnboardingDraft,
  TENANT_ID_KEY,
} from "@/lib/onboarding-storage";

const CLERK_ON = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

type SetupState = "missing" | "syncing" | "sync-error" | "auth-required";

/**
 * Tenant gate: resolves the signed-in user's tenant (or syncs a local
 * onboarding draft), then hands over to the MotApp shell.
 */
export default function Dashboard() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [setupState, setSetupState] = useState<SetupState>("missing");
  const [localGarageName, setLocalGarageName] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const adoptTenant = (id: string) => {
      localStorage.setItem(TENANT_ID_KEY, id);
      localStorage.setItem(ONBOARDING_SYNCED_TENANT_KEY, id);
      setTenantId(id);
    };

    (async () => {
      let serverLookupCompleted = false;
      try {
        // Server-side lookup by signed-in user works across devices.
        const res = await fetch("/api/tenant", { cache: "no-store" });
        const data = await res.json();
        serverLookupCompleted = true;
        if (data.tenant?.id) {
          if (!cancelled) adoptTenant(data.tenant.id);
          return;
        }
      } catch {
        /* fall through to local copy */
      }

      const localDraft = parseOnboardingDraft(localStorage.getItem(ONBOARDING_DRAFT_KEY));
      if (isCompleteOnboardingDraft(localDraft)) {
        if (!cancelled) {
          setLocalGarageName(localDraft.place.name);
          setSetupState("syncing");
          setChecked(true);
        }

        try {
          const res = await fetch("/api/tenant", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(localDraft),
          });

          if (res.status === 401) {
            if (!cancelled) setSetupState("auth-required");
            return;
          }

          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            if (!cancelled) {
              setSyncError(
                data.error === "garage_already_claimed"
                  ? "That garage is already claimed by another account."
                  : "We could not save your garage to your account yet.",
              );
              setSetupState("sync-error");
            }
            return;
          }

          if (data.tenantId) {
            if (!cancelled) {
              adoptTenant(data.tenantId);
              localStorage.setItem(ONBOARDING_STEP_KEY, "done");
            }
            return;
          }

          // Bare local dev can report local storage without a Supabase id.
          const localTenantId = localStorage.getItem(TENANT_ID_KEY);
          if (data.storage === "local" && localTenantId) {
            if (!cancelled) setTenantId(localTenantId);
            return;
          }

          if (!cancelled) {
            setSyncError("Your garage is saved locally, but no dashboard workspace exists yet.");
            setSetupState("sync-error");
          }
          return;
        } catch {
          if (!cancelled) {
            setSyncError("We could not reach the workspace sync service.");
            setSetupState("sync-error");
          }
          return;
        }
      }

      const localTenantId = localStorage.getItem(TENANT_ID_KEY);
      if (localTenantId && (!CLERK_ON || !serverLookupCompleted)) {
        if (!cancelled) setTenantId(localTenantId);
        return;
      }

      if (!cancelled) setSetupState("missing");
    })().finally(() => {
      if (!cancelled) setChecked(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!checked) return <main className="min-h-dvh bg-paper" />;

  if (!tenantId) {
    const hasSavedDraft = setupState === "syncing" || setupState === "sync-error";

    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-paper px-6 text-center">
        <h1 className="max-w-md text-balance text-3xl font-semibold tracking-tight text-ink">
          {setupState === "syncing" && "Syncing your saved garage"}
          {setupState === "sync-error" && "We found your saved garage"}
          {setupState === "auth-required" && "Sign in to sync your garage"}
          {setupState === "missing" && "Set up your garage first"}
        </h1>
        <p className="mt-3 max-w-sm text-sm text-ink/55">
          {setupState === "syncing" &&
            `${localGarageName ?? "Your garage"} is ready. We are saving it to your workspace now.`}
          {setupState === "sync-error" &&
            `${localGarageName ?? "Your saved garage"} is still safe on this device. ${
              syncError ?? "Continue setup to try syncing again."
            }`}
          {setupState === "auth-required" &&
            "Your garage is saved on this device. Open setup and sign in so we can attach it to your workspace."}
          {setupState === "missing" && "The dashboard unlocks once your garage profile is saved."}
        </p>
        {setupState === "syncing" && (
          <span className="mt-8 h-8 w-8 animate-spin rounded-full border-2 border-pine/15 border-t-pine" />
        )}
        <Link
          href={hasSavedDraft || setupState === "auth-required" ? "/start?resume=1" : "/start?new=1"}
          className={`mt-8 inline-flex items-center gap-2 rounded-full bg-pine px-8 py-3.5 text-sm font-semibold text-lime transition hover:brightness-110 active:scale-[0.98] ${
            setupState === "syncing" ? "pointer-events-none opacity-0" : ""
          }`}
        >
          {hasSavedDraft || setupState === "auth-required" ? "Continue setup" : "Start setup"}{" "}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </main>
    );
  }

  return <DashboardShell tenantId={tenantId} />;
}

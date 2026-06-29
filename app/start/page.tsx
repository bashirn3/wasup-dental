import { redirect } from "next/navigation";
import Wizard from "@/components/onboarding/Wizard";
import { clerkEnabled, resolveTenantId } from "@/lib/auth";

export const metadata = {
  title: "Set up your practice · Wasup Dental",
};

export const dynamic = "force-dynamic";

export default async function StartPage() {
  if (clerkEnabled()) {
    const tenantId = await resolveTenantId();
    if (tenantId) redirect("/dashboard");
  }

  return <Wizard />;
}

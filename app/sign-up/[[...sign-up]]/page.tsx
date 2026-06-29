import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import AuthShell from "@/components/auth/AuthShell";
import SignUpForm from "@/components/auth/SignUpForm";
import { clerkEnabled, resolveTenantId } from "@/lib/auth";

export const metadata = {
  title: "Create account · Wasup Dental",
  description: "Set up your dental practice workspace.",
};

export default async function SignUpPage() {
  if (!clerkEnabled()) redirect("/");

  const { userId } = await auth();
  if (userId) {
    const tenantId = await resolveTenantId();
    redirect(tenantId ? "/dashboard" : "/start?resume=1");
  }

  return (
    <AuthShell mode="sign-up">
      <SignUpForm />
    </AuthShell>
  );
}

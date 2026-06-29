import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import AuthShell from "@/components/auth/AuthShell";
import SignInForm from "@/components/auth/SignInForm";
import { clerkEnabled, resolveTenantId } from "@/lib/auth";

export const metadata = {
  title: "Sign in · Wasup Dental",
  description: "Open your dental workspace.",
};

export default async function SignInPage() {
  if (!clerkEnabled()) redirect("/");

  const { userId } = await auth();
  if (userId) {
    const tenantId = await resolveTenantId();
    redirect(tenantId ? "/dashboard" : "/start?resume=1");
  }

  return (
    <AuthShell mode="sign-in">
      <SignInForm />
    </AuthShell>
  );
}

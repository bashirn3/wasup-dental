import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import AuthShell from "@/components/auth/AuthShell";
import SignInForm from "@/components/auth/SignInForm";
import { clerkEnabled, resolveTenantId } from "@/lib/auth";

export const metadata = {
  title: "Sign in · RapidMOT",
  description: "Your leads kept moving while you were away. Sign in to catch up.",
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

import { redirect } from "next/navigation";
import { TaskSetupMFA } from "@clerk/nextjs";
import AuthTaskShell from "@/components/auth/AuthTaskShell";
import { clerkEnabled } from "@/lib/auth";
import { POST_AUTH_REDIRECT } from "@/lib/post-auth-redirect";
import "@/app/clerk-auth.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Secure your account · RapidMOT",
};

export default function SetupMfaTaskPage() {
  if (!clerkEnabled()) redirect("/");

  return (
    <AuthTaskShell
      title="Secure your account"
      subtitle="Add an extra verification step before we open your dashboard."
    >
      <TaskSetupMFA redirectUrlComplete={POST_AUTH_REDIRECT} />
    </AuthTaskShell>
  );
}

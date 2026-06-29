import { redirect } from "next/navigation";
import { TaskResetPassword } from "@clerk/nextjs";
import AuthTaskShell from "@/components/auth/AuthTaskShell";
import { clerkEnabled } from "@/lib/auth";
import { POST_AUTH_REDIRECT } from "@/lib/post-auth-redirect";
import "@/app/clerk-auth.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Reset password · RapidMOT",
};

export default function ResetPasswordTaskPage() {
  if (!clerkEnabled()) redirect("/");

  return (
    <AuthTaskShell
      title="Reset your password"
      subtitle="Clerk flagged this password as compromised. Set a new one to continue."
    >
      <TaskResetPassword redirectUrlComplete={POST_AUTH_REDIRECT} />
    </AuthTaskShell>
  );
}

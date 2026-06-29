import { redirect } from "next/navigation";
import { clerkEnabled } from "@/lib/auth";
import AuthContinue from "@/components/auth/AuthContinue";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Signing you in · RapidMOT",
};

export default function AuthContinuePage() {
  if (!clerkEnabled()) redirect("/");
  return <AuthContinue />;
}

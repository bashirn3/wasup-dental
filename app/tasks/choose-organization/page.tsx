import { redirect } from "next/navigation";
import AutoProvisionOrganization from "@/components/auth/AutoProvisionOrganization";
import { clerkEnabled } from "@/lib/auth";
import "@/app/clerk-auth.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Signing you in · Wasup Dental",
};

export default function ChooseOrganizationTaskPage() {
  if (!clerkEnabled()) redirect("/");
  return <AutoProvisionOrganization />;
}

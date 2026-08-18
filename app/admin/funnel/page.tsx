import { redirect } from "next/navigation";
import SalesFunnelDashboard from "@/components/admin/SalesFunnelDashboard";
import { resolveFunnelAccess } from "@/lib/dental-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Attribution Funnel · Wasup Dental" };

export default async function AdminFunnelPage() {
  // Internal admins see every practice; a named practice contact sees their own.
  const access = await resolveFunnelAccess();
  if (!access) redirect("/dashboard");

  return <SalesFunnelDashboard />;
}

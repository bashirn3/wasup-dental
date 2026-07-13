import { redirect } from "next/navigation";
import SalesFunnelDashboard from "@/components/admin/SalesFunnelDashboard";
import { requireInternalAdmin } from "@/lib/dental-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Attribution Funnel · Wasup Dental" };

export default async function AdminFunnelPage() {
  const admin = await requireInternalAdmin();
  if (!admin) redirect("/dashboard");

  return <SalesFunnelDashboard />;
}

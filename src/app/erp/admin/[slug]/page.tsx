import { redirect } from "next/navigation";
import Link from "next/link";
import { PageTitle } from "@/components/Northstar";
import { getCurrentNorthstarUser } from "@/lib/northstar-auth";
import { canViewNorthstarModule } from "@/lib/northstar-permissions";

const labels: Record<string, string> = {
  users: "Users", roles: "Roles & Permissions", locations: "Locations",
  "work-centers": "Work Centers", "approval-rules": "Approval Rules",
  tolerances: "Invoice Tolerances", templates: "Communication Templates",
  "reason-codes": "Reason Codes",
};

export default async function AdminConfigurationPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentNorthstarUser();
  if (!user || !canViewNorthstarModule(user, "admin")) redirect("/erp/dashboard");
  const { slug } = await params;
  const label = labels[slug];
  if (!label) redirect("/erp/admin");
  return <div className="ns-page"><Link className="ns-back" href="/erp/admin">← Back to Administration</Link><PageTitle eyebrow="SYSTEM CONFIGURATION" title={label} subtitle="Configuration is seeded and read-only in this demonstration environment."/><section className="ns-panel ns-admin-warning"><h2>{label}</h2><p>This reference area is intentionally constrained. Northstar does not expose a generic ERP customization engine; production configuration changes require controlled migration and review.</p></section></div>;
}

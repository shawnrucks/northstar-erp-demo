import Link from "next/link";
import { PageTitle } from "@/components/Northstar";
import { redirect } from "next/navigation";
import { getCurrentNorthstarUser } from "@/lib/northstar-auth";
import { canViewNorthstarModule } from "@/lib/northstar-permissions";

const configuration = [
  ["Users", "7 demo users", "/erp/admin/users"],
  ["Roles & Permissions", "7 operational roles", "/erp/admin/roles"],
  ["Customers", "12 active customers", "/erp/customers"],
  ["Suppliers", "140 supplier records", "/erp/suppliers"],
  ["Items", "150 active products", "/erp/inventory"],
  ["Locations", "3 operating facilities", "/erp/admin/locations"],
  ["Work Centers", "Machining, fabrication, assembly", "/erp/admin/work-centers"],
  ["Approval Rules", "Quote and purchasing thresholds", "/erp/admin/approval-rules"],
  ["Invoice Tolerances", "Price, quantity, freight, and tax", "/erp/admin/tolerances"],
  ["Communication Templates", "10 operational templates", "/erp/admin/templates"],
  ["Reason Codes", "Holds, delays, and exceptions", "/erp/admin/reason-codes"],
];

export default async function AdminPage() {
  const user = await getCurrentNorthstarUser();
  if (!user || !canViewNorthstarModule(user, "admin")) redirect("/erp/dashboard");
  return (
    <div className="ns-page">
      <PageTitle eyebrow="SYSTEM CONFIGURATION" title="Administration" subtitle="Controlled reference data and operating rules for the Northstar demo." />
      <div className="ns-admin-grid">
        {configuration.map(([label, description, href]) => (
          <Link href={href} className="ns-admin-card" key={label}>
            <span aria-hidden="true">⚙</span>
            <div><h2>{label}</h2><p>{description}</p></div>
            <b>Open →</b>
          </Link>
        ))}
      </div>
      <section className="ns-panel ns-admin-warning">
        <h2>Demo reset</h2>
        <p>Resetting restores all connected scenario records, queues, reports, tasks, communications, and audit events to their seeded state. This action is intentionally available only to administrators.</p>
        <p><code>npm run db:reset</code></p>
      </section>
    </div>
  );
}

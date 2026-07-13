import Link from "next/link";
import { PageTitle } from "@/components/Northstar";
import { northstarRepository } from "@/lib/northstar";
import { requireNorthstarModuleAccess } from "@/lib/northstar-guards";
import { canViewNorthstarModule } from "@/lib/northstar-permissions";

export default async function Page() {
  const user = await requireNorthstarModuleAccess("queues");
  const summary = await northstarRepository.getMetrics();
  const allQueues: Array<[string, string, number, string]> = [
    ["New RFQs", "new-rfqs", summary.newRfqs, "rfqs"],
    ["RFQ Missing Information", "rfq-missing-information", summary.rfqMissingInformation, "rfqs"],
    ["Quotes Awaiting Approval", "quotes-awaiting-approval", summary.quotes, "quotes"],
    ["Orders on Hold", "orders-on-hold", summary.holds, "sales-orders"],
    ["PO Awaiting Confirmation", "po-awaiting-confirmation", summary.confirmations, "purchase-orders"],
    ["Purchase Requisitions", "purchase-requisitions", 0, "purchase-orders"],
    ["Past Due POs", "past-due-pos", summary.pastDuePOs, "purchase-orders"],
    ["Material Shortages", "material-shortages", summary.shortages, "material-shortages"],
    ["Work Orders at Risk", "work-orders-at-risk", summary.atRiskWOs, "work-orders"],
    ["Production Exceptions", "production-exceptions", summary.productionExceptions, "production-exceptions"],
    ["Customer Updates Required", "customer-updates-required", summary.productionExceptions, "production-exceptions"],
    ["Quality Holds", "quality-holds", summary.quality, "quality"],
    ["Invoice Exceptions", "invoice-exceptions", summary.invoices, "invoices"],
  ];
  const queues = allQueues.filter(([, , , module]) => canViewNorthstarModule(user, module));

  return (
    <div className="ns-page">
      <PageTitle
        eyebrow="WORK MANAGEMENT"
        title="Work queues"
        subtitle="Manual operational work awaiting review or action."
      />
      <div className="ns-queue-grid">
        {queues.map(([label, slug, count]) => (
          <Link href={`/erp/queues/${slug}`} key={slug}>
            <span>▤</span>
            <div>
              <h2>{label}</h2>
              <p>Review, assign, prioritize, and open records.</p>
              <b>{count} open</b>
            </div>
            <i>→</i>
          </Link>
        ))}
      </div>
    </div>
  );
}

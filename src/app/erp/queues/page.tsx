import Link from "next/link";
import { PageTitle } from "@/components/Northstar";
import { northstarRepository } from "@/lib/northstar";

export default async function Page() {
  const summary = await northstarRepository.getMetrics();
  const queues: Array<[string, string, number]> = [
    ["New RFQs", "new-rfqs", summary.newRfqs],
    ["RFQ Missing Information", "rfq-missing-information", summary.rfqMissingInformation],
    ["Quotes Awaiting Approval", "quotes-awaiting-approval", summary.quotes],
    ["Orders on Hold", "orders-on-hold", summary.holds],
    ["PO Awaiting Confirmation", "po-awaiting-confirmation", summary.confirmations],
    ["Past Due POs", "past-due-pos", summary.pastDuePOs],
    ["Material Shortages", "material-shortages", summary.shortages],
    ["Work Orders at Risk", "work-orders-at-risk", summary.atRiskWOs],
    ["Production Exceptions", "production-exceptions", summary.productionExceptions],
    ["Quality Holds", "quality-holds", summary.quality],
    ["Invoice Exceptions", "invoice-exceptions", summary.invoices],
  ];

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

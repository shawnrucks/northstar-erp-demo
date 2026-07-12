import Link from "next/link";
import { Badge, PageTitle } from "@/components/Northstar";
import { northstarRepository, type NSRecord } from "@/lib/northstar";

function recordSection(record: NSRecord) {
  if (record.type === "RFQ") return "rfqs";
  if (record.type === "QUOTE") return "quotes";
  if (record.type === "PURCHASE_ORDER") return "purchase-orders";
  if (record.type === "WORK_ORDER") return "work-orders";
  if (record.type === "INVOICE") return "invoices";
  return "quality/holds";
}

export default async function Dashboard() {
  const [summary, attention] = await Promise.all([
    northstarRepository.getMetrics(),
    northstarRepository.listRecords({
      numbers: [
        "PO-10482",
        "WO-23891",
        "QT-2026-1047",
        "INV-SUM-8821",
        "QH-4491",
        "RFQ-2026-1047",
      ],
    }),
  ]);
  const cards: Array<[string, number, string]> = [
    ["New RFQs", summary.newRfqs, "new-rfqs"],
    ["Quotes Awaiting Approval", summary.quotes, "quotes-awaiting-approval"],
    ["Orders on Hold", summary.holds, "orders-on-hold"],
    ["Material Shortages", summary.shortages, "material-shortages"],
    ["Purchase Orders Past Due", summary.pastDuePOs, "past-due-pos"],
    ["Work Orders at Risk", summary.atRiskWOs, "work-orders-at-risk"],
    ["Quality Holds", summary.quality, "quality-holds"],
    ["Shipments Due Today", summary.shipments, "shipments-due"],
    ["Supplier Confirmations Missing", summary.confirmations, "po-awaiting-confirmation"],
    ["Invoice Exceptions", summary.invoices, "invoice-exceptions"],
  ];

  return (
    <div className="ns-page">
      <PageTitle
        eyebrow="OPERATIONS COMMAND CENTER"
        title="Manufacturing operations overview"
        subtitle="Live workload and exception status across Northstar facilities."
        actions={<span className="ns-live">● LIVE DATABASE</span>}
      />
      <div className="ns-metrics">
        {cards.map(([label, count, slug], index) => (
          <Link href={`/erp/queues/${slug}`} key={label}>
            <small>{label}</small>
            <b>{count}</b>
            <span>View queue →</span>
            <i className={index > 2 && count ? "warn" : ""} />
          </Link>
        ))}
      </div>
      <div className="ns-status-grid">
        <section>
          <h2>Production status</h2>
          {[
            ["Scheduled today", 12],
            ["Started", 8],
            ["Completed", 5],
            ["Behind schedule", 4],
            ["Waiting for material", summary.atRiskWOs],
          ].map(([label, count]) => <p key={label}><span>{label}</span><b>{count}</b></p>)}
        </section>
        <section>
          <h2>Supply-chain status</h2>
          {[
            ["POs due this week", 22],
            ["POs overdue", summary.pastDuePOs],
            ["Missing confirmation", summary.confirmations],
            ["Material shortages", summary.shortages],
            ["Expedite requests", 3],
          ].map(([label, count]) => <p key={label}><span>{label}</span><b>{count}</b></p>)}
        </section>
        <section>
          <h2>Customer commitments</h2>
          {[
            ["Orders due this week", 14],
            ["Orders at risk", 6],
            ["Late orders", 2],
            ["Waiting for response", 4],
          ].map(([label, count]) => <p key={label}><span>{label}</span><b>{count}</b></p>)}
        </section>
      </div>
      <section className="ns-panel">
        <div className="ns-panel-head">
          <h2>Attention required</h2>
          <Link href="/erp/queues">View all queues →</Link>
        </div>
        <table>
          <thead>
            <tr>
              <th>Severity</th>
              <th>Type</th>
              <th>Related record</th>
              <th>Customer / supplier</th>
              <th>Due date</th>
              <th>Owner</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {attention.map((row) => (
              <tr key={row.number}>
                <td><Badge>{row.priority}</Badge></td>
                <td>{row.type.replaceAll("_", " ")}</td>
                <td><b>{row.number}</b><small>{row.title}</small></td>
                <td>{row.party}</td>
                <td>{row.due_date}</td>
                <td>{row.owner}</td>
                <td><Badge>{row.status}</Badge></td>
                <td><Link href={`/erp/${recordSection(row)}/${row.number}`}>Open →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

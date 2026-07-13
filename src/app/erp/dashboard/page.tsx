import Link from "next/link";
import { Badge, PageTitle } from "@/components/Northstar";
import { northstarRepository, type NSRecord } from "@/lib/northstar";
import { requireNorthstarModuleAccess } from "@/lib/northstar-guards";
import { canViewNorthstarModule, canViewNorthstarRecord, visibleNorthstarRecordTypes } from "@/lib/northstar-permissions";
import { formatNorthstarDateTime } from "@/lib/northstar-format";

function recordSection(record: NSRecord) {
  if (record.type === "RFQ") return "rfqs";
  if (record.type === "QUOTE") return "quotes";
  if (record.type === "PURCHASE_ORDER") return "purchase-orders";
  if (record.type === "WORK_ORDER") return "work-orders";
  if (record.type === "INVOICE") return "invoices";
  return "quality/holds";
}

export default async function Dashboard() {
  const user = await requireNorthstarModuleAccess("dashboard");
  const canPlan = canViewNorthstarModule(user, "work-orders");
  const canPurchase = canViewNorthstarModule(user, "purchase-orders");
  const canSell = canViewNorthstarModule(user, "sales-orders");
  const canRfq = canViewNorthstarModule(user, "rfqs");
  const [summary, attention, workOrders, purchaseOrders, salesOrders, rfqs] = await Promise.all([
    northstarRepository.getMetrics(),
    northstarRepository.listRecords({
      types: visibleNorthstarRecordTypes(user),
      statuses: [
        "MISSING_INFORMATION",
        "AWAITING_APPROVAL",
        "ON_HOLD",
        "MATERIAL_PENDING",
        "AWAITING_CONFIRMATION",
        "PAST_DUE",
        "OPEN",
        "ESCALATED",
        "QUALITY_HOLD",
        "PRICE_EXCEPTION",
        "QUANTITY_EXCEPTION",
        "MISSING_RECEIPT",
        "MISSING_PO",
      ],
      limit: 12,
    }),
    canPlan ? northstarRepository.listRecords({ type: "WORK_ORDER", limit: 500 }) : [],
    canPurchase ? northstarRepository.listRecords({ type: "PURCHASE_ORDER", limit: 500 }) : [],
    canSell ? northstarRepository.listRecords({ type: "SALES_ORDER", limit: 500 }) : [],
    canRfq ? northstarRepository.listRecords({ type: "RFQ", limit: 500 }) : [],
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const weekFromToday = new Date(`${today}T00:00:00Z`);
  weekFromToday.setUTCDate(weekFromToday.getUTCDate() + 7);
  const weekEnd = weekFromToday.toISOString().slice(0, 10);
  const dueThisWeek = (dueDate: string | null) => Boolean(dueDate && dueDate >= today && dueDate <= weekEnd);
  const isClosed = (status: string) => ["COMPLETE", "COMPLETED", "CLOSED", "CANCELLED"].includes(status);
  const allCards: Array<[string, number, string, string]> = [
    ["New RFQs", summary.newRfqs, "new-rfqs", "rfqs"],
    ["Quotes Awaiting Approval", summary.quotes, "quotes-awaiting-approval", "quotes"],
    ["Orders on Hold", summary.holds, "orders-on-hold", "sales-orders"],
    ["Material Shortages", summary.shortages, "material-shortages", "material-shortages"],
    ["Purchase Orders Past Due", summary.pastDuePOs, "past-due-pos", "purchase-orders"],
    ["Work Orders at Risk", summary.atRiskWOs, "work-orders-at-risk", "work-orders"],
    ["Quality Holds", summary.quality, "quality-holds", "quality"],
    ["Shipments Due Today", summary.shipments, "shipments-due", "shipping"],
    ["Supplier Confirmations Missing", summary.confirmations, "po-awaiting-confirmation", "purchase-orders"],
    ["Invoice Exceptions", summary.invoices, "invoice-exceptions", "invoices"],
  ];
  const cards = allCards.filter(([, , , module]) => canViewNorthstarModule(user, module));
  const visibleAttention = attention.filter((record) => canViewNorthstarRecord(user, record.type));
  const statusSections: Array<{ title: string; rows: Array<[string, number]> }> = [];
  if (canPlan) statusSections.push({
    title: "Production status",
    rows: [
      ["Scheduled today", workOrders.filter((record) => record.due_date === today).length],
      ["Started", workOrders.filter((record) => record.status === "IN_PROGRESS").length],
      ["Completed", workOrders.filter((record) => isClosed(record.status)).length],
      ["Behind schedule", workOrders.filter((record) => Boolean(record.due_date && record.due_date < today) && !isClosed(record.status)).length],
      ["Waiting for material", workOrders.filter((record) => record.status === "MATERIAL_PENDING").length],
    ],
  });
  if (canPurchase) statusSections.push({
    title: "Supply-chain status",
    rows: [
      ["POs due this week", purchaseOrders.filter((record) => dueThisWeek(record.due_date)).length],
      ["POs overdue", purchaseOrders.filter((record) => record.status === "PAST_DUE").length],
      ["Missing confirmation", purchaseOrders.filter((record) => record.data.confirmation === "AWAITING_RESPONSE").length],
      ["Material shortages", summary.shortages],
      ["Expedite requests", purchaseOrders.filter((record) => record.priority === "URGENT").length],
    ],
  });
  if (canSell || canRfq) statusSections.push({
    title: "Customer commitments",
    rows: [
      ["Orders due this week", salesOrders.filter((record) => dueThisWeek(record.due_date)).length],
      ["Orders at risk", salesOrders.filter((record) => ["ON_HOLD", "MATERIAL_PENDING"].includes(record.status)).length],
      ["Late orders", salesOrders.filter((record) => Boolean(record.due_date && record.due_date < today) && !isClosed(record.status)).length],
      ["Waiting for response", rfqs.filter((record) => record.status === "MISSING_INFORMATION").length],
    ],
  });

  return (
    <div className="ns-page">
      <PageTitle
        eyebrow="OPERATIONS COMMAND CENTER"
        title="Manufacturing operations overview"
        subtitle="Live workload and exception status across Northstar facilities."
        actions={<span className="ns-live">● LIVE DATABASE · Refreshed {formatNorthstarDateTime(new Date())}</span>}
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
        {statusSections.map((section) => (
          <section key={section.title}>
            <h2>{section.title}</h2>
            {section.rows.map(([label, count]) => <p key={label}><span>{label}</span><b>{count}</b></p>)}
          </section>
        ))}
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
            {visibleAttention.map((row) => (
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

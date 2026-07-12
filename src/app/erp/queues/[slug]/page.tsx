import { PageTitle, RecordTable } from "@/components/Northstar";
import { northstarRepository, type NorthstarRecordFilter } from "@/lib/northstar";

type QueueConfiguration = {
  title: string;
  filter: NorthstarRecordFilter;
  base: string;
  subtitle: string;
};

const queues: Record<string, QueueConfiguration> = {
  "new-rfqs": {
    title: "New RFQs",
    filter: { type: "RFQ", status: "NEW" },
    base: "/erp/rfqs",
    subtitle: "RFQs waiting for intake review",
  },
  "rfq-missing-information": {
    title: "RFQs Missing Information",
    filter: { type: "RFQ", status: "MISSING_INFORMATION" },
    base: "/erp/rfqs",
    subtitle: "Customer input is required",
  },
  "quotes-awaiting-approval": {
    title: "Quotes Awaiting Approval",
    filter: { type: "QUOTE", status: "AWAITING_APPROVAL" },
    base: "/erp/quotes",
    subtitle: "Commercial approval required",
  },
  "orders-on-hold": {
    title: "Orders on Hold",
    filter: { type: "SALES_ORDER", status: "ON_HOLD" },
    base: "/erp/sales-orders",
    subtitle: "Held customer orders",
  },
  "po-awaiting-confirmation": {
    title: "PO Awaiting Confirmation",
    filter: { type: "PURCHASE_ORDER", confirmation: "AWAITING_RESPONSE" },
    base: "/erp/purchase-orders",
    subtitle: "Supplier confirmation has not been received",
  },
  "past-due-pos": {
    title: "Past Due Purchase Orders",
    filter: { type: "PURCHASE_ORDER", status: "PAST_DUE" },
    base: "/erp/purchase-orders",
    subtitle: "Delivery date has passed",
  },
  "material-shortages": {
    title: "Material Shortages",
    filter: { type: "SHORTAGE", excludeStatuses: ["RESOLVED"] },
    base: "/erp/material-shortages",
    subtitle: "Production demand exceeds available material",
  },
  "work-orders-at-risk": {
    title: "Work Orders at Risk",
    filter: { type: "WORK_ORDER", status: "MATERIAL_PENDING" },
    base: "/erp/work-orders",
    subtitle: "Jobs threatened by supply or schedule constraints",
  },
  "production-exceptions": {
    title: "Production Exceptions",
    filter: { type: "EXCEPTION", excludeStatuses: ["RESOLVED"] },
    base: "/erp/production-exceptions",
    subtitle: "Production issues requiring ownership",
  },
  "quality-holds": {
    title: "Quality Holds",
    filter: { type: "QUALITY_HOLD", status: "QUALITY_HOLD" },
    base: "/erp/quality/holds",
    subtitle: "Material or shipments blocked by quality",
  },
  "invoice-exceptions": {
    title: "Invoice Exceptions",
    filter: {
      type: "INVOICE",
      statuses: [
        "PRICE_EXCEPTION",
        "QUANTITY_EXCEPTION",
        "MISSING_RECEIPT",
        "MISSING_PO",
        "ON_HOLD",
      ],
    },
    base: "/erp/invoices",
    subtitle: "Three-way match exceptions",
  },
  "shipments-due": {
    title: "Shipments Due Today",
    filter: { type: "SALES_ORDER", dueToday: true },
    base: "/erp/sales-orders",
    subtitle: "Customer shipments scheduled today",
  },
};

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const configuration = queues[slug] || {
    title: slug.replaceAll("-", " "),
    filter: { numbers: [] },
    base: "/erp/dashboard",
    subtitle: "No records in this demo view",
  };
  const rows = await northstarRepository.listRecords(configuration.filter);

  return (
    <div className="ns-page">
      <PageTitle
        eyebrow="WORK QUEUE"
        title={configuration.title}
        subtitle={configuration.subtitle}
      />
      <RecordTable rows={rows} base={configuration.base} />
    </div>
  );
}

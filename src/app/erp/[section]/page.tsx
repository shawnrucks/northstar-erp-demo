import { notFound } from "next/navigation";
import { PageTitle, RecordTable, type RecordTableVariant } from "@/components/Northstar";
import { northstarRepository } from "@/lib/northstar";
import { requireNorthstarModuleAccess } from "@/lib/northstar-guards";

const sections: Record<string, { title: string; type: string; module: string; subtitle: string; variant?: RecordTableVariant; base?: string; plannerApprovalsOnly?: boolean }> = {
  customers: {
    title: "Customers",
    type: "CUSTOMER",
    module: "customers",
    variant: "customers",
    subtitle: "Customer accounts, requirements, and commitments",
  },
  rfqs: {
    title: "RFQs and Quotes",
    type: "RFQ",
    module: "rfqs",
    subtitle: "Incoming requests and estimating work",
  },
  quotes: {
    title: "Quotes",
    type: "QUOTE",
    module: "quotes",
    subtitle: "Costing and commercial approval",
  },
  "quote-approvals": {
    title: "Lead-Time Quote Approvals",
    type: "QUOTE",
    module: "quote-approvals",
    base: "/erp/quotes",
    plannerApprovalsOnly: true,
    subtitle: "Quotes requiring production-planning review without commercial costing access",
  },
  "sales-orders": {
    title: "Sales Orders",
    type: "SALES_ORDER",
    module: "sales-orders",
    subtitle: "Customer demand and fulfillment status",
  },
  "production-planning": {
    title: "Production Planning",
    type: "WORK_ORDER",
    module: "production-planning",
    variant: "production-planning",
    subtitle: "Demand, material, and capacity planning",
  },
  "work-orders": {
    title: "Work Orders",
    type: "WORK_ORDER",
    module: "work-orders",
    variant: "work-orders",
    subtitle: "Released and planned production jobs",
  },
  "purchase-orders": {
    title: "Purchase Orders",
    type: "PURCHASE_ORDER",
    module: "purchase-orders",
    variant: "purchase-orders",
    subtitle: "Supplier commitments and delivery follow-up",
  },
  "purchase-requisitions": {
    title: "Purchase Requisitions",
    type: "PURCHASE_REQUISITION",
    module: "purchase-orders",
    subtitle: "Internal material demand awaiting purchasing review",
  },
  suppliers: {
    title: "Suppliers",
    type: "SUPPLIER",
    module: "suppliers",
    variant: "suppliers",
    subtitle: "Approved sources and supplier performance",
  },
  inventory: {
    title: "Inventory",
    type: "ITEM",
    module: "inventory",
    variant: "inventory",
    subtitle: "Items, balances, and material availability",
  },
  invoices: {
    title: "Supplier Invoices",
    type: "INVOICE",
    module: "invoices",
    variant: "invoices",
    subtitle: "Three-way matching and invoice exceptions",
  },
  "invoice-exceptions": {
    title: "Invoice Exceptions",
    type: "INVOICE",
    module: "invoices",
    variant: "invoice-exceptions",
    subtitle: "Price, quantity, receipt, and purchase-order match exceptions",
  },
  "material-shortages": {
    title: "Material Shortages",
    type: "SHORTAGE",
    module: "material-shortages",
    variant: "material-shortages",
    subtitle: "Material demand, supply gaps, transfers, and recovery plans",
  },
  "production-exceptions": {
    title: "Production Exceptions",
    type: "EXCEPTION",
    module: "production-exceptions",
    variant: "production-exceptions",
    subtitle: "Schedule, material, labor, tooling, and quality disruptions",
  },
  shipping: {
    title: "Shipping",
    type: "SALES_ORDER",
    module: "shipping",
    subtitle: "Customer shipments and documentation",
  },
  admin: {
    title: "Administration",
    type: "CUSTOMER",
    module: "admin",
    subtitle: "Demo configuration reference",
  },
};

export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const configuration = sections[section];
  if (!configuration) notFound();
  await requireNorthstarModuleAccess(configuration.module);
  const allRows = await northstarRepository.listRecords({
    type: configuration.type,
    limit: 500,
  });
  const filteredRows = configuration.plannerApprovalsOnly
    ? allRows.filter((row) => {
        const requirements = Array.isArray(row.data.approvalRequirements)
          ? row.data.approvalRequirements.map(String)
          : String(row.data.approval || "").split(",").filter(Boolean);
        const completed = new Set(Array.isArray(row.data.approvalsCompleted) ? row.data.approvalsCompleted.map(String) : []);
        return row.status === "AWAITING_APPROVAL" && requirements.includes("PRODUCTION_PLANNER") && !completed.has("PRODUCTION_PLANNER");
      })
    : allRows;
  const rows = configuration.plannerApprovalsOnly
    ? filteredRows.map((row) => ({
        ...row,
        data: {
          leadTimeDays: row.data.leadTimeDays,
          standardLeadTimeDays: row.data.standardLeadTimeDays,
        },
      }))
    : filteredRows;

  return (
    <div className="ns-page">
      <PageTitle
        eyebrow="NORTHSTAR ERP"
        title={configuration.title}
        subtitle={configuration.subtitle}
      />
      <RecordTable rows={rows} base={configuration.base || `/erp/${section}`} variant={configuration.variant} />
    </div>
  );
}

import { PageTitle, RecordTable } from "@/components/Northstar";
import { northstarRepository } from "@/lib/northstar";

const sections: Record<string, { title: string; type: string; subtitle: string }> = {
  customers: {
    title: "Customers",
    type: "CUSTOMER",
    subtitle: "Customer accounts, requirements, and commitments",
  },
  rfqs: {
    title: "RFQs and Quotes",
    type: "RFQ",
    subtitle: "Incoming requests and estimating work",
  },
  quotes: {
    title: "Quotes",
    type: "QUOTE",
    subtitle: "Costing and commercial approval",
  },
  "sales-orders": {
    title: "Sales Orders",
    type: "SALES_ORDER",
    subtitle: "Customer demand and fulfillment status",
  },
  "production-planning": {
    title: "Production Planning",
    type: "WORK_ORDER",
    subtitle: "Demand, material, and capacity planning",
  },
  "work-orders": {
    title: "Work Orders",
    type: "WORK_ORDER",
    subtitle: "Released and planned production jobs",
  },
  "purchase-orders": {
    title: "Purchase Orders",
    type: "PURCHASE_ORDER",
    subtitle: "Supplier commitments and delivery follow-up",
  },
  suppliers: {
    title: "Suppliers",
    type: "SUPPLIER",
    subtitle: "Approved sources and supplier performance",
  },
  inventory: {
    title: "Inventory",
    type: "ITEM",
    subtitle: "Items, balances, and material availability",
  },
  invoices: {
    title: "Supplier Invoices",
    type: "INVOICE",
    subtitle: "Three-way matching and invoice exceptions",
  },
  shipping: {
    title: "Shipping",
    type: "SALES_ORDER",
    subtitle: "Customer shipments and documentation",
  },
  admin: {
    title: "Administration",
    type: "CUSTOMER",
    subtitle: "Demo configuration reference",
  },
};

export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const configuration = sections[section] || {
    title: section.replaceAll("-", " "),
    type: "RFQ",
    subtitle: "Operational records",
  };
  const rows = await northstarRepository.listRecords({
    type: configuration.type,
    limit: section === "suppliers" ? 25 : 100,
  });

  return (
    <div className="ns-page">
      <PageTitle
        eyebrow="NORTHSTAR ERP"
        title={configuration.title}
        subtitle={configuration.subtitle}
      />
      <RecordTable rows={rows} base={`/erp/${section}`} />
    </div>
  );
}

import Link from "next/link";
import { PageTitle, RecordTable } from "@/components/Northstar";
import { northstarRepository } from "@/lib/northstar";
import { requireNorthstarModuleAccess } from "@/lib/northstar-guards";

export default async function InspectionsPage() {
  await requireNorthstarModuleAccess("quality");
  const rows = await northstarRepository.listRecords({
    type: "QUALITY_INSPECTION",
    limit: 500,
  });

  return (
    <div className="ns-page">
      <PageTitle
        eyebrow="QUALITY MANAGEMENT"
        title="Quality Inspections"
        subtitle="Receiving, in-process, final, and first-article inspection records"
      />
      <nav className="ns-tabs" aria-label="Quality modules">
        <Link href="/erp/quality/holds">Holds</Link>
        <Link aria-current="page" href="/erp/quality/inspections">Inspections</Link>
        <Link href="/erp/quality/nonconformances">Nonconformances</Link>
        <Link href="/erp/quality/rtv">Returns to Vendor</Link>
      </nav>
      <RecordTable rows={rows} base="/erp/quality/inspections" />
    </div>
  );
}

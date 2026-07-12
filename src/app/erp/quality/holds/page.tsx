import { PageTitle, RecordTable } from "@/components/Northstar";
import { northstarRepository } from "@/lib/northstar";

export default async function Page() {
  const holds = await northstarRepository.listRecords({
    type: "QUALITY_HOLD",
    status: "QUALITY_HOLD",
  });

  return (
    <div className="ns-page">
      <PageTitle
        eyebrow="QUALITY"
        title="Quality Holds"
        subtitle="Material and customer shipments under controlled hold"
      />
      <RecordTable rows={holds} base="/erp/quality/holds" />
    </div>
  );
}

import { PageTitle, RecordTable } from "@/components/Northstar";
import { northstarRepository } from "@/lib/northstar";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const query = (await searchParams).q?.trim() || "";
  const results = query ? await northstarRepository.listRecords({ search: query }) : [];

  return (
    <div className="ns-page">
      <PageTitle
        title={`Search results for “${query}”`}
        subtitle={`${results.length} matching operational records`}
      />
      <RecordTable rows={results} base="/erp/records" />
    </div>
  );
}

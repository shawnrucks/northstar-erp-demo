import { PageTitle, RecordTable } from "@/components/Northstar";
import { northstarRepository } from "@/lib/northstar";
import { requireNorthstarModuleAccess } from "@/lib/northstar-guards";
import { visibleNorthstarRecordTypes } from "@/lib/northstar-permissions";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const query = (await searchParams).q?.trim() || "";
  const user = await requireNorthstarModuleAccess("dashboard");
  const results = query
      ? await northstarRepository.listRecords({
        search: query,
        types: visibleNorthstarRecordTypes(user),
        limit: 500,
      })
    : [];

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

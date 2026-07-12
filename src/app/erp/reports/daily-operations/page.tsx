import { northstarRepository, northstarSql } from "@/lib/northstar";
import { PageTitle } from "@/components/Northstar";
import ReportForm from "./ReportForm";

export default async function Page() {
  const [reports, issueRows, metricSnapshot] = await Promise.all([
    northstarRepository.all<Record<string, unknown>>("SELECT * FROM reports ORDER BY id DESC LIMIT 10"),
    northstarRepository.all<Record<string, unknown>>(northstarSql({postgres:`
    SELECT number, type, title, party, status, priority, due_date, data
      FROM records
     WHERE number IN ('WO-23891', 'PO-10482', 'MS-3021', 'PE-1187', 'QH-4491', 'INV-SUM-8821')
     ORDER BY CASE priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END, due_date`,sqlite:`
    SELECT number, type, title, party, status, priority, due_date, data
      FROM records
     WHERE number IN ('WO-23891', 'PO-10482', 'MS-3021', 'PE-1187', 'QH-4491', 'INV-SUM-8821')
     ORDER BY CASE priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END, due_date
  `})),
    northstarRepository.getMetrics(),
  ]);
  const issues = issueRows.map((row) => {const data=typeof row.data==="string"?JSON.parse(row.data||"{}"):row.data as Record<string,unknown>;return {...row,preselected:Boolean(data?.includeInNextReport)}}) as Array<{number:string;type:string;title:string;party:string;status:string;priority:string;due_date:string;preselected:boolean}>;
  const savedReports = reports.map((report) => ({id:Number(report.id),number:String(report.number),report_date:String(report.report_date),prepared_by:String(report.prepared_by),status:String(report.status)}));
  return (
    <div className="ns-page">
      <PageTitle eyebrow="OPERATIONS REPORTING" title="Daily Operations Report" subtitle="Create, review, and finalize a management-ready operating brief." />
      <ReportForm metrics={metricSnapshot} reports={savedReports} issues={issues} />
    </div>
  );
}

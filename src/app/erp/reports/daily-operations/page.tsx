import { northstarRepository, northstarSql } from "@/lib/northstar";
import { PageTitle } from "@/components/Northstar";
import { serializeNorthstarDate } from "@/lib/northstar-format";
import { requireNorthstarModuleAccess } from "@/lib/northstar-guards";
import { authorizeNorthstarReportAction } from "@/lib/northstar-permissions";
import ReportForm from "./ReportForm";

const narrativeKeys = ["production", "supplyChain", "customerCommitments", "inventory", "quality", "finance"] as const;

function reportNarratives(value: unknown) {
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { parsed = {}; }
  }
  const source = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  return Object.fromEntries(narrativeKeys.map((key) => [key, typeof source[key] === "string" ? source[key] : ""])) as Record<(typeof narrativeKeys)[number], string>;
}

function reportRecordNumbers(value: unknown) {
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { parsed = []; }
  }
  if (!Array.isArray(parsed)) return [];
  return Array.from(new Set(parsed.filter((item): item is string => typeof item === "string" && item.length <= 100)));
}

export default async function Page() {
  const user = await requireNorthstarModuleAccess("reports");
  const [reports, reportSelectionRows, issueRows, metricSnapshot] = await Promise.all([
    northstarRepository.all<Record<string, unknown>>(`
      SELECT id, number, report_date, prepared_by, status, executive_summary,
             management_decisions, narratives
        FROM reports
       ORDER BY id DESC
       LIMIT 10
    `),
    northstarRepository.all<Record<string, unknown>>(northstarSql({postgres:`
      SELECT rr.report_id, rr.record_number
        FROM report_records rr
        JOIN (SELECT id FROM reports ORDER BY id DESC LIMIT 10) recent
          ON recent.id = rr.report_id
       ORDER BY rr.report_id, rr.record_number
    `,sqlite:`
      SELECT id AS report_id, included_records
        FROM reports
       ORDER BY id DESC
       LIMIT 10
    `})),
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
  const reportSelections = new Map<string, string[]>();
  for (const row of reportSelectionRows) {
    const reportId = String(row.report_id);
    const existing = reportSelections.get(reportId) || [];
    const additions = row.record_number == null
      ? reportRecordNumbers(row.included_records)
      : [String(row.record_number)];
    reportSelections.set(reportId, Array.from(new Set([...existing, ...additions])));
  }
  const issues = issueRows.map((row) => {
    const data = typeof row.data === "string" ? JSON.parse(row.data || "{}") : row.data as Record<string, unknown>;
    return {
      number: String(row.number),
      type: String(row.type),
      title: String(row.title),
      party: String(row.party || ""),
      status: String(row.status),
      priority: String(row.priority),
      due_date: serializeNorthstarDate(row.due_date),
      preselected: Boolean(data?.includeInNextReport),
    };
  });
  const savedReports = reports.map((report) => ({
    id: Number(report.id),
    number: String(report.number),
    report_date: serializeNorthstarDate(report.report_date),
    prepared_by: String(report.prepared_by),
    status: String(report.status),
    executive_summary: String(report.executive_summary || ""),
    management_decisions: String(report.management_decisions || ""),
    narratives: reportNarratives(report.narratives),
    included_records: reportSelections.get(String(report.id)) || [],
  }));
  const permissions = {
    saveDraft: authorizeNorthstarReportAction(user, "saveDraft"),
    finalize: authorizeNorthstarReportAction(user, "finalize"),
    export: authorizeNorthstarReportAction(user, "export"),
  };
  return (
    <div className="ns-page">
      <PageTitle eyebrow="OPERATIONS REPORTING" title="Daily Operations Report" subtitle="Create, review, and finalize a management-ready operating brief." />
      <ReportForm metrics={metricSnapshot} reports={savedReports} issues={issues} permissions={permissions} />
    </div>
  );
}

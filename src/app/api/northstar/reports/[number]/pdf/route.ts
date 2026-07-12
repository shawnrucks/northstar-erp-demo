import { northstarRepository, northstarSql } from "@/lib/northstar";
import { authenticateNorthstarRequest } from "@/lib/northstar-auth";
import { authorizeNorthstarReportAction } from "@/lib/northstar-permissions";

const escapePdfText = (value: string) =>
  value
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .replaceAll(/[^\x20-\x7E]/g, "");

export async function GET(
  request: Request,
  { params }: { params: Promise<{ number: string }> },
) {
  const user = await authenticateNorthstarRequest(request);
  if (!user) return new Response("Sign in required", { status: 401 });
  if (!authorizeNorthstarReportAction(user, "export")) {
    return new Response("Your role is not authorized to export operations reports.", {
      status: 403,
    });
  }

  const { number } = await params;
  if (!/^DOR-[A-Z0-9-]{1,46}$/.test(number)) {
    return new Response("Invalid report number", { status: 400 });
  }

  const report = await northstarRepository.get<Record<string, unknown>>(
    northstarSql({ postgres: "SELECT * FROM reports WHERE number = $1", sqlite: "SELECT * FROM reports WHERE number = ?" }),
    [number],
  );
  if (!report) return new Response("Not found", { status: 404 });

  let reportMetrics: Record<string, number>;
  let narratives: Record<string, string>;
  let includedRecords: string[];
  try {
    reportMetrics = typeof report.metrics === "string" ? JSON.parse(report.metrics) : report.metrics as Record<string, number>;
    narratives = typeof report.narratives === "string" ? JSON.parse(report.narratives) : report.narratives as Record<string, string>;
    if (northstarRepository.provider === "postgres") {
      const linked = await northstarRepository.all<{ record_number: string }>("SELECT record_number FROM report_records WHERE report_id=$1 ORDER BY record_number", [report.id]);
      includedRecords = linked.map((row) => row.record_number);
    } else includedRecords = JSON.parse(String(report.included_records || "[]"));
  } catch {
    return new Response("Report data is invalid", { status: 500 });
  }

  const lines = [
    "NORTHSTAR INDUSTRIAL COMPONENTS",
    "DAILY OPERATIONS REPORT",
    `${report.number} | ${report.report_date} | Prepared by ${report.prepared_by}`,
    "",
    `Status: ${report.status}`,
    "EXECUTIVE SUMMARY",
    report.executive_summary || "No summary entered.",
    "",
    "OPERATING METRICS",
    `New RFQs: ${reportMetrics.newRfqs}   Quotes awaiting approval: ${reportMetrics.quotes}   Orders on hold: ${reportMetrics.holds}`,
    `Material shortages: ${reportMetrics.shortages}   Past due POs: ${reportMetrics.pastDuePOs}   Work orders at risk: ${reportMetrics.atRiskWOs}`,
    `Quality holds: ${reportMetrics.quality}   Missing confirmations: ${reportMetrics.confirmations}   Invoice exceptions: ${reportMetrics.invoices}`,
    "",
    "PRODUCTION SUMMARY",
    narratives.production || "No production narrative entered.",
    "SUPPLY-CHAIN SUMMARY",
    narratives.supplyChain || "No supply-chain narrative entered.",
    "CUSTOMER COMMITMENTS",
    narratives.customerCommitments || "No customer commitment narrative entered.",
    "INVENTORY SUMMARY",
    narratives.inventory || "No inventory narrative entered.",
    "QUALITY SUMMARY",
    narratives.quality || "No quality narrative entered.",
    "FINANCE SUMMARY",
    narratives.finance || "No finance narrative entered.",
    "",
    "INCLUDED OPERATIONAL RECORDS",
    includedRecords.length ? includedRecords.join(", ") : "No records explicitly included.",
    "",
    "MANAGEMENT DECISIONS",
    report.management_decisions || "No decisions entered.",
    "",
    report.finalized_at ? `Finalized: ${report.finalized_at}` : "Draft report",
  ].flatMap((value) => String(value).match(/.{1,90}(?:\s|$)/g) || [String(value)]);

  const textStream = lines
    .map(
      (line, index) =>
        `BT /F1 ${index < 2 ? 15 : 9} Tf ${index === 0 ? 84 : 50} ${760 - index * 17} Td (${escapePdfText(line.trim())}) Tj ET`,
    )
    .join("\n");
  const stream = `0.12 0.38 0.58 rg 46 744 28 28 re f\n1 1 1 rg BT /F1 18 Tf 54 751 Td (N) Tj ET\n0 0 0 rg\n${textStream}`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const crossReference = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n `)
    .join("\n")}\ntrailer << /Size 6 /Root 1 0 R >>\nstartxref\n${crossReference}\n%%EOF`;

  return new Response(pdf, {
    headers: {
      "cache-control": "private, no-store",
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${number}.pdf"`,
      "x-content-type-options": "nosniff",
    },
  });
}

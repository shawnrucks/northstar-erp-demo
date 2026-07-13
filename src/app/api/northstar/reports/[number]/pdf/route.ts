import { northstarRepository, northstarSql } from "@/lib/northstar";
import { authenticateNorthstarRequest } from "@/lib/northstar-auth";
import { serializeNorthstarDate } from "@/lib/northstar-format";
import { authorizeNorthstarReportAction } from "@/lib/northstar-permissions";

const escapePdfText = (value: string) =>
  value
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .replaceAll(/[^\x20-\x7E]/g, "");

function wrapPdfLines(values: unknown[], width = 90) {
  return values.flatMap((rawValue) => {
    const value = String(rawValue ?? "").trim();
    if (!value) return [""];
    const words = value.split(/\s+/);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      if (word.length > width) {
        if (current) lines.push(current);
        for (let offset = 0; offset < word.length; offset += width) {
          lines.push(word.slice(offset, offset + width));
        }
        current = "";
      } else if (!current) {
        current = word;
      } else if (`${current} ${word}`.length <= width) {
        current += ` ${word}`;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines;
  });
}

function buildPdf(lines: string[], reportNumber: string) {
  const linesPerPage = 35;
  const pages = Array.from(
    { length: Math.max(1, Math.ceil(lines.length / linesPerPage)) },
    (_, index) => lines.slice(index * linesPerPage, (index + 1) * linesPerPage),
  );
  const pageCount = pages.length;
  const fontId = 3 + pageCount * 2;
  const pageObjects = pages.map((_, index) => {
    const contentId = 3 + pageCount + index;
    return `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
  });
  const contentObjects = pages.map((pageLines, pageIndex) => {
    const body = pageLines
      .map((line, lineIndex) => {
        const heading = /^[A-Z][A-Z &-]{4,}$/.test(line);
        return `BT /F1 ${heading ? 11 : 9} Tf 50 ${710 - lineIndex * 18} Td (${escapePdfText(line)}) Tj ET`;
      })
      .join("\n");
    const stream = [
      "0.12 0.38 0.58 rg 46 744 28 28 re f",
      "1 1 1 rg BT /F1 18 Tf 54 751 Td (N) Tj ET",
      `0 0 0 rg BT /F1 10 Tf 84 755 Td (NORTHSTAR INDUSTRIAL COMPONENTS) Tj ET`,
      `BT /F1 8 Tf 50 42 Td (${escapePdfText(reportNumber)} | Page ${pageIndex + 1} of ${pageCount}) Tj ET`,
      body,
    ].join("\n");
    return `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  const pageIds = pages.map((_, index) => `${3 + index} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageIds}] /Count ${pageCount} >>`,
    ...pageObjects,
    ...contentObjects,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const crossReference = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n `)
    .join("\n")}\ntrailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${crossReference}\n%%EOF`;
  return pdf;
}

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

  const lines = wrapPdfLines([
    "DAILY OPERATIONS REPORT",
    `${report.number} | ${serializeNorthstarDate(report.report_date) || "Date unavailable"} | Prepared by ${report.prepared_by}`,
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
    report.finalized_at ? `Finalized: ${String(report.finalized_at)}` : "Draft report",
  ]);
  const pdf = buildPdf(lines, String(report.number));

  return new Response(pdf, {
    headers: {
      "cache-control": "private, no-store",
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${number}.pdf"`,
      "x-content-type-options": "nosniff",
    },
  });
}

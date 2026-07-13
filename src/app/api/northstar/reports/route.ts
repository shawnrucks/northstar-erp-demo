import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { northstarRepository, northstarSql } from "@/lib/northstar";
import { authenticateNorthstarRequest, isJsonRequest, isSameOriginRequest } from "@/lib/northstar-auth";
import { authorizeNorthstarReportAction } from "@/lib/northstar-permissions";
import { executeNorthstarMutation } from "@/lib/northstar-mutation-guard";

type ReportRow = { id: number | string; status: string };

class ReportConflict extends Error {}
class ReportSessionExpired extends Error {}
class ReportResetInProgress extends Error {}

function reportText(value: unknown, field: string, max: number) {
  if (value == null) return "";
  if (typeof value !== "string") throw new Error(`${field} must be text.`);
  const result = value.trim();
  if (result.length > max) throw new Error(`${field} is too long.`);
  return result;
}

function generatedReportNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `DOR-${date}-${randomInt(100_000, 1_000_000)}`;
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 });
  const user = await authenticateNorthstarRequest(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  return executeNorthstarMutation(request, user, "operations-report", async () => {

  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const input = raw as Record<string, unknown>;
  if (input.finalize != null && typeof input.finalize !== "boolean") return NextResponse.json({ error: "finalize must be a boolean." }, { status: 400 });
  const finalize = input.finalize === true;
  if (!authorizeNorthstarReportAction(user, finalize ? "finalize" : "saveDraft")) {
    return NextResponse.json({ error: "Your role is not authorized to save operations reports." }, { status: 403 });
  }

  let suppliedNumber = "";
  let executiveSummary = "";
  let managementDecisions = "";
  const narratives: Record<string, string> = {};
  let includedRecords: string[] = [];
  try {
    suppliedNumber = input.number == null ? "" : reportText(input.number, "number", 50);
    if (suppliedNumber && !/^DOR-[A-Z0-9-]+$/.test(suppliedNumber)) throw new Error("Invalid report number.");
    executiveSummary = reportText(input.executiveSummary, "executiveSummary", 10_000);
    if (!executiveSummary) throw new Error("Executive summary is required.");
    managementDecisions = reportText(input.managementDecisions, "managementDecisions", 10_000);
    const rawNarratives = input.narratives == null ? {} : input.narratives;
    if (!rawNarratives || typeof rawNarratives !== "object" || Array.isArray(rawNarratives)) throw new Error("narratives must be an object.");
    for (const key of ["production", "supplyChain", "customerCommitments", "inventory", "quality", "finance"]) {
      narratives[key] = reportText((rawNarratives as Record<string, unknown>)[key], `${key} narrative`, 5_000);
    }
    if (input.includedRecords != null && !Array.isArray(input.includedRecords)) throw new Error("includedRecords must be an array.");
    includedRecords = Array.from(new Set((input.includedRecords as unknown[] | undefined || []).map((value) => {
      if (typeof value !== "string" || !/^[A-Z]+-[A-Z0-9-]+$/.test(value) || value.length > 100) throw new Error("includedRecords contains an invalid record number.");
      return value;
    }))).slice(0, 100);
    for (const recordNumber of includedRecords) {
      if (!(await northstarRepository.findRecord(recordNumber))) throw new Error(`Included record ${recordNumber} was not found.`);
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid report content." }, { status: 400 });
  }

  const number = suppliedNumber || generatedReportNumber();
  const status = finalize ? "FINAL" : "DRAFT";
  const snapshot = JSON.stringify(await northstarRepository.getMetrics());
  const narrativeSnapshot = JSON.stringify(narratives);
  const inclusionSnapshot = JSON.stringify(includedRecords);
  const finalizedAt = finalize ? new Date().toISOString() : null;

  try {
    await northstarRepository.transaction(async (transaction) => {
      if (transaction.provider === "postgres") {
        await transaction.run("SELECT pg_advisory_xact_lock_shared(hashtext($1))", [
          "northstar_demo_data_v1",
        ]);
        await transaction.run("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `northstar_report_${number}`,
        ]);
      }
      const resetState = await transaction.get<{ reset_in_progress: boolean | number }>(
        northstarSql({
          postgres: "SELECT reset_in_progress FROM demo_state WHERE singleton = true",
          sqlite: "SELECT reset_in_progress FROM demo_state WHERE singleton = 1",
        }),
      );
      if (resetState?.reset_in_progress === true || Number(resetState?.reset_in_progress) === 1) {
        throw new ReportResetInProgress();
      }
      const activeSession = await transaction.get<{ active: number }>(
        northstarSql({
          postgres: `SELECT 1 AS active
                       FROM northstar_sessions
                      WHERE token_hash LIKE $1
                        AND revoked_at IS NULL
                        AND expires_at > now()`,
          sqlite: `SELECT 1 AS active
                     FROM northstar_sessions
                    WHERE token_hash LIKE ?
                      AND expires_at > strftime('%s','now')`,
        }),
        [`${user.session}%`],
      );
      if (!activeSession) throw new ReportSessionExpired();

      const found = await transaction.get<ReportRow>(
        northstarSql({
          postgres: "SELECT id, status FROM reports WHERE number = $1 FOR UPDATE",
          sqlite: "SELECT id, status FROM reports WHERE number = ?",
        }),
        [number],
      );
      if (found?.status === "FINAL") {
        throw new ReportConflict("Final reports are immutable and cannot be changed.");
      }

      let reportId: number | string;
      if (found) {
        reportId = found.id;
        await transaction.run(
        northstarSql({
          postgres: `UPDATE reports SET executive_summary=$1, management_decisions=$2, narratives=$3::jsonb, status=$4, metrics=$5::jsonb, finalized_at=$6 WHERE number=$7`,
          sqlite: `UPDATE reports SET executive_summary=?, management_decisions=?, narratives=?, included_records=?, status=?, metrics=?, finalized_at=? WHERE number=?`,
        }),
        transaction.provider === "postgres"
          ? [executiveSummary, managementDecisions, narrativeSnapshot, status, snapshot, finalizedAt, number]
          : [executiveSummary, managementDecisions, narrativeSnapshot, inclusionSnapshot, status, snapshot, finalizedAt, number],
      );
      } else if (transaction.provider === "postgres") {
        const inserted = await transaction.get<{ id: string | number }>(
        `INSERT INTO reports(number,report_date,prepared_by,status,executive_summary,management_decisions,narratives,metrics,finalized_at) VALUES($1,CURRENT_DATE,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8) RETURNING id`,
        [number, user.name, status, executiveSummary, managementDecisions, narrativeSnapshot, snapshot, finalizedAt],
      );
        if (!inserted) throw new Error("Report could not be created.");
        reportId = inserted.id;
      } else {
        await transaction.run(
        `INSERT INTO reports(number,report_date,prepared_by,status,executive_summary,management_decisions,narratives,included_records,metrics,finalized_at) VALUES(?,date('now'),?,?,?,?,?,?,?,?)`,
        [number, user.name, status, executiveSummary, managementDecisions, narrativeSnapshot, inclusionSnapshot, snapshot, finalizedAt],
      );
        const inserted = await transaction.get<{ id: number }>("SELECT id FROM reports WHERE number=?", [number]);
        if (!inserted) throw new Error("Report could not be created.");
        reportId = inserted.id;
      }

      if (transaction.provider === "postgres") {
        await transaction.run("DELETE FROM report_records WHERE report_id=$1", [reportId]);
        for (const recordNumber of includedRecords) {
          await transaction.run("INSERT INTO report_records(report_id,record_number,included_by) VALUES($1,$2,$3)", [reportId, recordNumber, user.name]);
        }
      }
      await transaction.run(
      northstarSql({
        postgres: `INSERT INTO audit_events(user_name,user_role,module,record_type,record_number,action,note,session_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        sqlite: `INSERT INTO audit_events(user,user_role,module,record_type,record_number,action,note,session_id) VALUES(?,?,?,?,?,?,?,?)`,
      }),
        [user.name, user.role, "Reports", "Daily Operations Report", number, finalize ? "Report finalized" : found ? "Report updated" : "Report created", finalize ? "Final report saved" : "Draft report saved", user.session],
      );
    });
  } catch (error) {
    if (error instanceof ReportConflict) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof ReportSessionExpired) {
      return NextResponse.json({ error: "Your session expired. Sign in again." }, { status: 401 });
    }
    if (error instanceof ReportResetInProgress) {
      return NextResponse.json(
        { error: "Demo data is being reset. Try again after signing in." },
        { status: 409 },
      );
    }
    console.error("Northstar report save failed", error);
    return NextResponse.json({ error: "The report could not be saved." }, { status: 500 });
  }

  const response = NextResponse.json({ ok: true, number, status });
  response.headers.set("cache-control", "no-store");
  return response;
  });
}

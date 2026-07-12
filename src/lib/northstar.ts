import type Database from "better-sqlite3";
import { scryptSync, timingSafeEqual } from "node:crypto";
import {
  getNorthstarSqliteDatabase,
  northstarRepository,
  type NorthstarRecord,
} from "@/lib/northstar-repository";

export {
  northstarRepository,
  northstarSql,
  type AppendAuditEvent,
  type NorthstarDatabaseProvider,
  type NorthstarAuditActor,
  type NorthstarMetrics,
  type NorthstarQueryExecutor,
  type NorthstarRecord,
  type NorthstarRecordData,
  type NorthstarRecordFilter,
  type NorthstarRepository,
  type NorthstarRunResult,
  type NorthstarSql,
} from "@/lib/northstar-repository";

/** @deprecated Migrate callers to the asynchronous northstarRepository API. */
export const nsdb = new Proxy({} as Database.Database, {
  get(_target, property) {
    const database = getNorthstarSqliteDatabase();
    const value = Reflect.get(database, property, database);
    return typeof value === "function" ? value.bind(database) : value;
  },
});

export type NSRecord = NorthstarRecord;

function legacyRecord(row: Omit<NorthstarRecord, "data"> & { data: string | Record<string, unknown> }) {
  let data: Record<string, unknown> = {};
  if (row.data && typeof row.data === "object") data = row.data;
  else if (typeof row.data === "string") {
    try {
      const parsed = JSON.parse(row.data);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed;
    } catch {
      data = {};
    }
  }
  return { ...row, data } as NorthstarRecord;
}

/** @deprecated Use northstarRepository.listRecords for PostgreSQL-compatible code. */
export function records(where = "1=1", params: unknown[] = []) {
  return (
    getNorthstarSqliteDatabase()
      .prepare(
        `SELECT * FROM records WHERE ${where}
         ORDER BY CASE priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END,
                  due_date
         LIMIT 100`,
      )
      .all(...params) as Array<Omit<NorthstarRecord, "data"> & { data: string }>
  ).map(legacyRecord);
}

/** @deprecated Use northstarRepository.findRecord for PostgreSQL-compatible code. */
export function record(number: string) {
  const row = getNorthstarSqliteDatabase()
    .prepare("SELECT * FROM records WHERE number = ?")
    .get(number) as (Omit<NorthstarRecord, "data"> & { data: string }) | undefined;
  return row ? legacyRecord(row) : null;
}

/** @deprecated Use northstarRepository.getMetrics for PostgreSQL-compatible code. */
export function metrics() {
  const database = getNorthstarSqliteDatabase();
  const count = (sql: string) =>
    Number(database.prepare(sql).pluck().get() || 0);
  return {
    newRfqs: count("SELECT count(*) FROM records WHERE type='RFQ' AND status='NEW'"),
    rfqMissingInformation: count(
      "SELECT count(*) FROM records WHERE type='RFQ' AND status='MISSING_INFORMATION'",
    ),
    quotes: count(
      "SELECT count(*) FROM records WHERE type='QUOTE' AND status='AWAITING_APPROVAL'",
    ),
    holds: count(
      "SELECT count(*) FROM records WHERE type='SALES_ORDER' AND status='ON_HOLD'",
    ),
    shortages: count(
      "SELECT count(*) FROM records WHERE type='SHORTAGE' AND status!='RESOLVED'",
    ),
    pastDuePOs: count(
      "SELECT count(*) FROM records WHERE type='PURCHASE_ORDER' AND status='PAST_DUE'",
    ),
    atRiskWOs: count(
      "SELECT count(*) FROM records WHERE type='WORK_ORDER' AND status='MATERIAL_PENDING'",
    ),
    productionExceptions: count(
      "SELECT count(*) FROM records WHERE type='EXCEPTION' AND status!='RESOLVED'",
    ),
    quality: count(
      "SELECT count(*) FROM records WHERE type='QUALITY_HOLD' AND status='QUALITY_HOLD'",
    ),
    shipments: count(
      "SELECT count(*) FROM records WHERE type='SALES_ORDER' AND due_date=date('now')",
    ),
    confirmations: count(
      "SELECT count(*) FROM records WHERE type='PURCHASE_ORDER' AND json_extract(data,'$.confirmation')='AWAITING_RESPONSE'",
    ),
    invoices: count(
      "SELECT count(*) FROM records WHERE type='INVOICE' AND status IN ('PRICE_EXCEPTION','QUANTITY_EXCEPTION','MISSING_RECEIPT','MISSING_PO','ON_HOLD')",
    ),
  };
}

export function verify(password: string, stored: string) {
  const [salt, encodedKey, extra] = stored.split(":");
  if (extra !== undefined || !salt || !/^[a-f0-9]{128}$/i.test(encodedKey || "")) return false;

  try {
    const expected = Buffer.from(encodedKey, "hex");
    const actual = scryptSync(password, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function audit(
  recordNumber: string,
  user: import("@/lib/northstar-repository").NorthstarAuditActor,
  action: string,
  field?: string,
  oldValue?: unknown,
  newValue?: unknown,
  note?: string,
) {
  const current = record(recordNumber);
  getNorthstarSqliteDatabase()
    .prepare(
      `INSERT INTO audit_events
        (user, user_role, module, record_type, record_number, action, field_changed,
         previous_value, new_value, note, session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      user.name,
      user.role,
      current?.type || "System",
      current?.type || "Record",
      recordNumber,
      action,
      field || null,
      oldValue == null ? null : String(oldValue),
      newValue == null ? null : String(newValue),
      note || null,
      user.session || "demo-session",
    );
}

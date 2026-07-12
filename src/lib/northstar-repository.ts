import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

export type NorthstarDatabaseProvider = "postgres" | "sqlite";

export type NorthstarSql = {
  postgres: string;
  sqlite: string;
};

export type NorthstarRunResult = {
  changes: number;
  rows: QueryResultRow[];
  lastInsertRowid?: number | bigint;
};

export type NorthstarRecordData = Record<string, unknown>;

export type NorthstarRecord = {
  id: number;
  type: string;
  number: string;
  title: string;
  party: string;
  status: string;
  priority: string;
  owner: string;
  due_date: string | null;
  data: NorthstarRecordData;
  updated_at: string;
};

export type NorthstarRecordFilter = {
  type?: string;
  types?: readonly string[];
  status?: string;
  statuses?: readonly string[];
  excludeStatuses?: readonly string[];
  numbers?: readonly string[];
  confirmation?: string;
  search?: string;
  dueDate?: string;
  dueToday?: boolean;
  limit?: number;
};

export type NorthstarMetrics = {
  newRfqs: number;
  rfqMissingInformation: number;
  quotes: number;
  holds: number;
  shortages: number;
  pastDuePOs: number;
  atRiskWOs: number;
  productionExceptions: number;
  quality: number;
  shipments: number;
  confirmations: number;
  invoices: number;
};

export type NorthstarAuditActor = {
  name: string;
  role: string;
  session?: string;
};

export type AppendAuditEvent = {
  recordNumber: string;
  actor: NorthstarAuditActor;
  action: string;
  module?: string;
  recordType?: string;
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
  note?: string;
};

export interface NorthstarQueryExecutor {
  readonly provider: NorthstarDatabaseProvider;
  all<T extends QueryResultRow = QueryResultRow>(
    statement: string | NorthstarSql,
    parameters?: readonly unknown[],
  ): Promise<T[]>;
  get<T extends QueryResultRow = QueryResultRow>(
    statement: string | NorthstarSql,
    parameters?: readonly unknown[],
  ): Promise<T | null>;
  run(
    statement: string | NorthstarSql,
    parameters?: readonly unknown[],
  ): Promise<NorthstarRunResult>;
}

export interface NorthstarRepository extends NorthstarQueryExecutor {
  transaction<T>(
    work: (transaction: NorthstarQueryExecutor) => Promise<T> | T,
  ): Promise<T>;
  listRecords(filter?: NorthstarRecordFilter): Promise<NorthstarRecord[]>;
  findRecord(number: string): Promise<NorthstarRecord | null>;
  getMetrics(): Promise<NorthstarMetrics>;
  appendAuditEvent(event: AppendAuditEvent): Promise<void>;
  listAuditEvents(options?: {
    recordNumber?: string;
    search?: string;
    date?: string;
    limit?: number;
  }): Promise<Array<Record<string, unknown>>>;
  countRecords(): Promise<number>;
  healthCheck(): Promise<{ provider: NorthstarDatabaseProvider; records: number }>;
}

export function northstarSql(sql: NorthstarSql): NorthstarSql {
  return sql;
}

function configuredProvider(): NorthstarDatabaseProvider {
  return process.env.DATABASE_URL?.trim() ? "postgres" : "sqlite";
}

function resolveStatement(
  statement: string | NorthstarSql,
  provider: NorthstarDatabaseProvider,
) {
  return typeof statement === "string" ? statement : statement[provider];
}

function postgresUrl() {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required for the PostgreSQL provider.");

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres:// or postgresql:// protocol.");
  }
  return value;
}

function poolSize() {
  const requested = Number(process.env.NORTHSTAR_DATABASE_POOL_MAX || 10);
  return Number.isInteger(requested) && requested > 0 && requested <= 50 ? requested : 10;
}

const globalWithNorthstarPool = globalThis as typeof globalThis & {
  __northstarPostgresPool?: Pool;
};

function postgresPool() {
  if (!globalWithNorthstarPool.__northstarPostgresPool) {
    const pool = new Pool({
      connectionString: postgresUrl(),
      application_name: "northstar-web",
      max: poolSize(),
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      query_timeout: 30_000,
      statement_timeout: 30_000,
    });
    pool.on("error", (error) => {
      console.error("Northstar PostgreSQL pool error:", error.message);
    });
    globalWithNorthstarPool.__northstarPostgresPool = pool;
  }
  return globalWithNorthstarPool.__northstarPostgresPool;
}

let sqliteDatabase: Database.Database | null = null;

export function getNorthstarSqliteDatabase() {
  if (configuredProvider() === "postgres") {
    throw new Error(
      "A SQLite-only Northstar call was used while DATABASE_URL is configured. Use northstarRepository instead.",
    );
  }
  if (sqliteDatabase) return sqliteDatabase;

  const filename =
    process.env.NORTHSTAR_DATABASE_PATH || path.join(process.cwd(), "data/northstar.sqlite3");
  if (!existsSync(filename)) {
    execFileSync(process.execPath, [path.join(process.cwd(), "scripts/northstar-setup.mjs")], {
      cwd: process.cwd(),
      env: { ...process.env, NORTHSTAR_DATABASE_PATH: filename },
      stdio: "ignore",
    });
  }
  sqliteDatabase = new Database(filename);
  sqliteDatabase.pragma("foreign_keys = ON");
  sqliteDatabase.pragma("busy_timeout = 5000");
  return sqliteDatabase;
}

class AsyncMutex {
  private tail = Promise.resolve();

  async use<T>(work: () => Promise<T>): Promise<T> {
    let release = () => {};
    const ticket = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.tail;
    this.tail = previous.then(() => ticket);
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }
}

const sqliteMutex = new AsyncMutex();

function postgresExecutor(client: Pool | PoolClient): NorthstarQueryExecutor {
  return {
    provider: "postgres",
    async all<T extends QueryResultRow>(statement: string | NorthstarSql, parameters = []) {
      const result = await client.query<T>(resolveStatement(statement, "postgres"), [...parameters]);
      return result.rows;
    },
    async get<T extends QueryResultRow>(statement: string | NorthstarSql, parameters = []) {
      const result = await client.query<T>(resolveStatement(statement, "postgres"), [...parameters]);
      return result.rows[0] ?? null;
    },
    async run(statement: string | NorthstarSql, parameters = []) {
      const result = await client.query(resolveStatement(statement, "postgres"), [...parameters]);
      return { changes: result.rowCount ?? 0, rows: result.rows };
    },
  };
}

function unlockedSqliteExecutor(database: Database.Database): NorthstarQueryExecutor {
  return {
    provider: "sqlite",
    async all<T extends QueryResultRow>(statement: string | NorthstarSql, parameters = []) {
      return database.prepare(resolveStatement(statement, "sqlite")).all(...parameters) as T[];
    },
    async get<T extends QueryResultRow>(statement: string | NorthstarSql, parameters = []) {
      return (
        (database.prepare(resolveStatement(statement, "sqlite")).get(...parameters) as T | undefined) ??
        null
      );
    },
    async run(statement: string | NorthstarSql, parameters = []) {
      const result = database.prepare(resolveStatement(statement, "sqlite")).run(...parameters);
      return {
        changes: result.changes,
        rows: [],
        lastInsertRowid: result.lastInsertRowid,
      };
    },
  };
}

function sqliteExecutor(): NorthstarQueryExecutor {
  return {
    provider: "sqlite",
    all<T extends QueryResultRow>(statement: string | NorthstarSql, parameters = []) {
      return sqliteMutex.use(() =>
        unlockedSqliteExecutor(getNorthstarSqliteDatabase()).all<T>(statement, parameters),
      );
    },
    get<T extends QueryResultRow>(statement: string | NorthstarSql, parameters = []) {
      return sqliteMutex.use(() =>
        unlockedSqliteExecutor(getNorthstarSqliteDatabase()).get<T>(statement, parameters),
      );
    },
    run(statement: string | NorthstarSql, parameters = []) {
      return sqliteMutex.use(() =>
        unlockedSqliteExecutor(getNorthstarSqliteDatabase()).run(statement, parameters),
      );
    },
  };
}

function executor(): NorthstarQueryExecutor {
  return configuredProvider() === "postgres"
    ? postgresExecutor(postgresPool())
    : sqliteExecutor();
}

function placeholder(provider: NorthstarDatabaseProvider, position: number) {
  return provider === "postgres" ? `$${position}` : "?";
}

function placeholders(provider: NorthstarDatabaseProvider, start: number, count: number) {
  return Array.from({ length: count }, (_, index) => placeholder(provider, start + index)).join(", ");
}

function boundedLimit(value: number | undefined, fallback: number, maximum: number) {
  if (value == null) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(maximum, Math.trunc(value)));
}

function parseRecordData(value: unknown): NorthstarRecordData {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as NorthstarRecordData;
  }
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as NorthstarRecordData)
      : {};
  } catch {
    return {};
  }
}

function normalizeRecord(row: Record<string, unknown>): NorthstarRecord {
  return {
    id: Number(row.id),
    type: String(row.type),
    number: String(row.number),
    title: String(row.title),
    party: String(row.party || ""),
    status: String(row.status),
    priority: String(row.priority || "NORMAL"),
    owner: String(row.owner || ""),
    due_date: row.due_date == null ? null : String(row.due_date),
    data: parseRecordData(row.data),
    updated_at: String(row.updated_at || ""),
  };
}

function escapeLike(value: string) {
  return value.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_");
}

async function listRecords(filter: NorthstarRecordFilter = {}) {
  const database = executor();
  const provider = database.provider;
  const parameters: unknown[] = [];
  const conditions: string[] = [];
  const add = (value: unknown) => {
    parameters.push(value);
    return placeholder(provider, parameters.length);
  };
  const addList = (values: readonly string[], column: string, negate = false) => {
    if (values.length === 0) {
      conditions.push(negate ? "1 = 1" : "1 = 0");
      return;
    }
    const start = parameters.length + 1;
    parameters.push(...values);
    conditions.push(
      `${column} ${negate ? "NOT IN" : "IN"} (${placeholders(provider, start, values.length)})`,
    );
  };

  if (filter.type) conditions.push(`type = ${add(filter.type)}`);
  if (filter.types) addList(filter.types, "type");
  if (filter.status) conditions.push(`status = ${add(filter.status)}`);
  if (filter.statuses) addList(filter.statuses, "status");
  if (filter.excludeStatuses) addList(filter.excludeStatuses, "status", true);
  if (filter.numbers) addList(filter.numbers, "number");
  if (filter.confirmation) {
    conditions.push(
      provider === "postgres"
        ? `data ->> 'confirmation' = ${add(filter.confirmation)}`
        : `json_extract(data, '$.confirmation') = ${add(filter.confirmation)}`,
    );
  }
  if (filter.search?.trim()) {
    const search = `%${escapeLike(filter.search.trim())}%`;
    const operator = provider === "postgres" ? "ILIKE" : "LIKE";
    const dataExpression = provider === "postgres" ? "data::text" : "data";
    const terms = ["number", "title", "party", dataExpression].map(
      (column) => `${column} ${operator} ${add(search)} ESCAPE '!'`,
    );
    conditions.push(`(${terms.join(" OR ")})`);
  }
  if (filter.dueDate) conditions.push(`due_date = ${add(filter.dueDate)}`);
  if (filter.dueToday) {
    conditions.push(provider === "postgres" ? "due_date = CURRENT_DATE" : "due_date = date('now')");
  }

  const limit = boundedLimit(filter.limit, 100, 500);
  const limitParameter = add(limit);
  const rows = await database.all(
    `SELECT id, type, number, title, party, status, priority, owner, due_date, data, updated_at
       FROM records
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY CASE priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END,
               due_date,
               number
      LIMIT ${limitParameter}`,
    parameters,
  );
  return rows.map((row) => normalizeRecord(row));
}

async function findRecord(number: string) {
  const rows = await listRecords({ numbers: [number], limit: 1 });
  return rows[0] ?? null;
}

async function getMetrics(): Promise<NorthstarMetrics> {
  const database = executor();
  const statement = northstarSql({
    postgres: `
      SELECT
        count(*) FILTER (WHERE type = 'RFQ' AND status = 'NEW')::integer AS new_rfqs,
        count(*) FILTER (WHERE type = 'RFQ' AND status = 'MISSING_INFORMATION')::integer AS rfq_missing_information,
        count(*) FILTER (WHERE type = 'QUOTE' AND status = 'AWAITING_APPROVAL')::integer AS quotes,
        count(*) FILTER (WHERE type = 'SALES_ORDER' AND status = 'ON_HOLD')::integer AS holds,
        count(*) FILTER (WHERE type = 'SHORTAGE' AND status <> 'RESOLVED')::integer AS shortages,
        count(*) FILTER (WHERE type = 'PURCHASE_ORDER' AND status = 'PAST_DUE')::integer AS past_due_pos,
        count(*) FILTER (WHERE type = 'WORK_ORDER' AND status = 'MATERIAL_PENDING')::integer AS at_risk_wos,
        count(*) FILTER (WHERE type = 'EXCEPTION' AND status <> 'RESOLVED')::integer AS production_exceptions,
        count(*) FILTER (WHERE type = 'QUALITY_HOLD' AND status = 'QUALITY_HOLD')::integer AS quality,
        count(*) FILTER (WHERE type = 'SALES_ORDER' AND due_date = CURRENT_DATE)::integer AS shipments,
        count(*) FILTER (WHERE type = 'PURCHASE_ORDER' AND data ->> 'confirmation' = 'AWAITING_RESPONSE')::integer AS confirmations,
        count(*) FILTER (WHERE type = 'INVOICE' AND status IN ('PRICE_EXCEPTION', 'QUANTITY_EXCEPTION', 'MISSING_RECEIPT', 'MISSING_PO', 'ON_HOLD'))::integer AS invoices
      FROM records`,
    sqlite: `
      SELECT
        sum(CASE WHEN type = 'RFQ' AND status = 'NEW' THEN 1 ELSE 0 END) AS new_rfqs,
        sum(CASE WHEN type = 'RFQ' AND status = 'MISSING_INFORMATION' THEN 1 ELSE 0 END) AS rfq_missing_information,
        sum(CASE WHEN type = 'QUOTE' AND status = 'AWAITING_APPROVAL' THEN 1 ELSE 0 END) AS quotes,
        sum(CASE WHEN type = 'SALES_ORDER' AND status = 'ON_HOLD' THEN 1 ELSE 0 END) AS holds,
        sum(CASE WHEN type = 'SHORTAGE' AND status <> 'RESOLVED' THEN 1 ELSE 0 END) AS shortages,
        sum(CASE WHEN type = 'PURCHASE_ORDER' AND status = 'PAST_DUE' THEN 1 ELSE 0 END) AS past_due_pos,
        sum(CASE WHEN type = 'WORK_ORDER' AND status = 'MATERIAL_PENDING' THEN 1 ELSE 0 END) AS at_risk_wos,
        sum(CASE WHEN type = 'EXCEPTION' AND status <> 'RESOLVED' THEN 1 ELSE 0 END) AS production_exceptions,
        sum(CASE WHEN type = 'QUALITY_HOLD' AND status = 'QUALITY_HOLD' THEN 1 ELSE 0 END) AS quality,
        sum(CASE WHEN type = 'SALES_ORDER' AND due_date = date('now') THEN 1 ELSE 0 END) AS shipments,
        sum(CASE WHEN type = 'PURCHASE_ORDER' AND json_extract(data, '$.confirmation') = 'AWAITING_RESPONSE' THEN 1 ELSE 0 END) AS confirmations,
        sum(CASE WHEN type = 'INVOICE' AND status IN ('PRICE_EXCEPTION', 'QUANTITY_EXCEPTION', 'MISSING_RECEIPT', 'MISSING_PO', 'ON_HOLD') THEN 1 ELSE 0 END) AS invoices
      FROM records`,
  });
  const row = (await database.get(statement)) ?? {};
  const value = (name: string) => Number(row[name] || 0);
  return {
    newRfqs: value("new_rfqs"),
    rfqMissingInformation: value("rfq_missing_information"),
    quotes: value("quotes"),
    holds: value("holds"),
    shortages: value("shortages"),
    pastDuePOs: value("past_due_pos"),
    atRiskWOs: value("at_risk_wos"),
    productionExceptions: value("production_exceptions"),
    quality: value("quality"),
    shipments: value("shipments"),
    confirmations: value("confirmations"),
    invoices: value("invoices"),
  };
}

function auditValue(value: unknown) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

async function appendAuditEvent(event: AppendAuditEvent) {
  const current = await findRecord(event.recordNumber);
  const module = event.module || current?.type || "System";
  const recordType = event.recordType || current?.type || "Record";
  await executor().run(
    northstarSql({
      postgres: `INSERT INTO audit_events
        (user_name, user_role, module, record_type, record_number, action, field_changed,
         previous_value, new_value, note, session_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      sqlite: `INSERT INTO audit_events
        (user, user_role, module, record_type, record_number, action, field_changed,
         previous_value, new_value, note, session_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    }),
    [
      event.actor.name,
      event.actor.role,
      module,
      recordType,
      event.recordNumber,
      event.action,
      event.field || null,
      auditValue(event.oldValue),
      auditValue(event.newValue),
      event.note || null,
      event.actor.session || "demo-session",
    ],
  );
}

async function listAuditEvents(
  options: { recordNumber?: string; search?: string; date?: string; limit?: number } = {},
) {
  const database = executor();
  const parameters: unknown[] = [];
  const conditions: string[] = [];
  const add = (value: unknown) => {
    parameters.push(value);
    return placeholder(database.provider, parameters.length);
  };
  if (options.recordNumber) conditions.push(`record_number = ${add(options.recordNumber)}`);
  if (options.search?.trim()) {
    const value = `%${escapeLike(options.search.trim())}%`;
    const operator = database.provider === "postgres" ? "ILIKE" : "LIKE";
    const userColumn = database.provider === "postgres" ? "user_name" : "user";
    conditions.push(
      `(${[userColumn, "record_number", "action", "module", "note"]
        .map((column) => `${column} ${operator} ${add(value)} ESCAPE '!'`)
        .join(" OR ")})`,
    );
  }
  if (options.date && /^\d{4}-\d{2}-\d{2}$/.test(options.date)) {
    conditions.push(
      database.provider === "postgres"
        ? `timestamp::date = ${add(options.date)}::date`
        : `date(timestamp) = ${add(options.date)}`,
    );
  }
  const limit = boundedLimit(options.limit, 300, 1_000);
  parameters.push(limit);
  const userColumn = database.provider === "postgres" ? "user_name AS \"user\"" : "user";
  return database.all(
    `SELECT id, timestamp, ${userColumn}, user_role, module, record_type, record_number,
            action, field_changed, previous_value, new_value, note, session_id
       FROM audit_events
       ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY timestamp DESC, id DESC
      LIMIT ${placeholder(database.provider, parameters.length)}`,
    parameters,
  );
}

async function countRecords() {
  const row = await executor().get<{ count: number | string }>(
    northstarSql({
      postgres: "SELECT count(*)::integer AS count FROM records",
      sqlite: "SELECT count(*) AS count FROM records",
    }),
  );
  return Number(row?.count || 0);
}

async function transaction<T>(
  work: (transaction: NorthstarQueryExecutor) => Promise<T> | T,
) {
  if (configuredProvider() === "postgres") {
    const client = await postgresPool().connect();
    try {
      await client.query("BEGIN");
      const result = await work(postgresExecutor(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  return sqliteMutex.use(async () => {
    const database = getNorthstarSqliteDatabase();
    const local = unlockedSqliteExecutor(database);
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = await work(local);
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  });
}

export const northstarRepository: NorthstarRepository = {
  get provider() {
    return configuredProvider();
  },
  all<T extends QueryResultRow>(statement: string | NorthstarSql, parameters = []) {
    return executor().all<T>(statement, parameters);
  },
  get<T extends QueryResultRow>(statement: string | NorthstarSql, parameters = []) {
    return executor().get<T>(statement, parameters);
  },
  run(statement: string | NorthstarSql, parameters = []) {
    return executor().run(statement, parameters);
  },
  transaction,
  listRecords,
  findRecord,
  getMetrics,
  appendAuditEvent,
  listAuditEvents,
  countRecords,
  async healthCheck() {
    const records = await countRecords();
    return { provider: configuredProvider(), records };
  },
};

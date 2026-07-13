import { randomUUID } from "node:crypto";

import {
  northstarRepository,
  northstarSql,
  type NorthstarQueryExecutor,
} from "@/lib/northstar";
import type { NorthstarUser } from "@/lib/northstar-auth";

export const NORTHSTAR_DEMO_RESET_LOCK = "northstar_demo_data_v1";

const EXPECTED_RECORD_COUNT = 2_090;
const EXPECTED_USER_COUNT = 7;
const DEFAULT_COOLDOWN_SECONDS = 5 * 60;
const STALE_RESET_SECONDS = 15 * 60;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

type ResetErrorCode =
  | "BUSY"
  | "COOLDOWN"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "IDEMPOTENCY_FAILED"
  | "INVALID_IDEMPOTENCY_KEY"
  | "TEMPLATES_UNAVAILABLE"
  | "RESET_FAILED";

export class NorthstarDemoResetError extends Error {
  readonly code: ResetErrorCode;
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(code: ResetErrorCode, status: number, retryAfterSeconds?: number) {
    super(code);
    this.name = "NorthstarDemoResetError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

type DemoStateRow = {
  seed_version: number | string;
  anchor_date: string | Date | null;
  canonical_record_count: number | string;
  generation: number | string;
  reset_in_progress: boolean | number | string;
  active_reset_run_id: string | null;
  last_reset_started_at: string | Date | null;
  last_reset_completed_at: string | Date | null;
  last_reset_by: string | null;
  cooldown_until: string | Date | null;
};

type ResetRunRow = {
  id: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  record_count: number | string | null;
  generation: number | string | null;
  completed_at: string | Date | null;
};

export type NorthstarDemoResetStatus = {
  available: boolean;
  provider: "postgres" | "sqlite";
  seedVersion: number;
  anchorDate: string | null;
  canonicalRecordCount: number;
  liveRecordCount: number;
  generation: number;
  resetInProgress: boolean;
  lastResetAt: string | null;
  lastResetBy: string | null;
  cooldownUntil: string | null;
  cooldownRemainingSeconds: number;
};

export type NorthstarDemoResetResult = {
  runId: string;
  generation: number;
  recordCount: number;
  completedAt: string;
  replayed: boolean;
};

function asBoolean(value: DemoStateRow["reset_in_progress"]) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function iso(value: string | Date | null | undefined) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function dateOnly(value: string | Date | null | undefined) {
  const normalized = iso(value);
  return normalized ? normalized.slice(0, 10) : null;
}

function cooldownSeconds() {
  const requested = Number(process.env.NORTHSTAR_DEMO_RESET_COOLDOWN_SECONDS);
  if (!Number.isInteger(requested)) return DEFAULT_COOLDOWN_SECONDS;
  return Math.max(0, Math.min(86_400, requested));
}

function retryAfter(value: string | Date | null | undefined) {
  const normalized = iso(value);
  if (!normalized) return 0;
  return Math.max(0, Math.ceil((Date.parse(normalized) - Date.now()) / 1_000));
}

async function stateRow(database: NorthstarQueryExecutor, lock = false) {
  return database.get<DemoStateRow>(
    northstarSql({
      postgres: `SELECT seed_version, anchor_date, canonical_record_count, generation,
                        reset_in_progress, active_reset_run_id, last_reset_started_at,
                        last_reset_completed_at, last_reset_by, cooldown_until
                   FROM demo_state
                  WHERE singleton = true${lock ? " FOR UPDATE" : ""}`,
      sqlite: `SELECT seed_version, anchor_date, canonical_record_count, generation,
                      reset_in_progress, active_reset_run_id, last_reset_started_at,
                      last_reset_completed_at, last_reset_by, cooldown_until
                 FROM demo_state
                WHERE singleton = 1`,
    }),
  );
}

async function templateRecordCount(database: NorthstarQueryExecutor) {
  const row = await database.get<{ count: number | string }>(
    northstarSql({
      postgres: "SELECT count(*)::integer AS count FROM northstar_demo_record_templates",
      sqlite: "SELECT count(*) AS count FROM northstar_demo_record_templates",
    }),
  );
  return Number(row?.count || 0);
}

export async function getNorthstarDemoResetStatus(): Promise<NorthstarDemoResetStatus> {
  const [state, templateCount, liveRecordCount] = await Promise.all([
    stateRow(northstarRepository),
    templateRecordCount(northstarRepository),
    northstarRepository.countRecords(),
  ]);
  if (!state) throw new NorthstarDemoResetError("TEMPLATES_UNAVAILABLE", 503);

  const canonicalRecordCount = Number(state.canonical_record_count || 0);
  const cooldownUntil = iso(state.cooldown_until);
  return {
    available:
      canonicalRecordCount === EXPECTED_RECORD_COUNT && templateCount === EXPECTED_RECORD_COUNT,
    provider: northstarRepository.provider,
    seedVersion: Number(state.seed_version || 0),
    anchorDate: dateOnly(state.anchor_date),
    canonicalRecordCount,
    liveRecordCount,
    generation: Number(state.generation || 0),
    resetInProgress: asBoolean(state.reset_in_progress),
    lastResetAt: iso(state.last_reset_completed_at),
    lastResetBy: state.last_reset_by || null,
    cooldownUntil,
    cooldownRemainingSeconds: retryAfter(cooldownUntil),
  };
}

async function findRun(database: NorthstarQueryExecutor, idempotencyKey: string) {
  return database.get<ResetRunRow>(
    northstarSql({
      postgres: `SELECT id, status, record_count, generation, completed_at
                   FROM demo_reset_runs WHERE idempotency_key = $1`,
      sqlite: `SELECT id, status, record_count, generation, completed_at
                 FROM demo_reset_runs WHERE idempotency_key = ?`,
    }),
    [idempotencyKey],
  );
}

function completedRunResult(run: ResetRunRow): NorthstarDemoResetResult {
  return {
    runId: run.id,
    generation: Number(run.generation || 0),
    recordCount: Number(run.record_count || 0),
    completedAt: iso(run.completed_at) || new Date(0).toISOString(),
    replayed: true,
  };
}

async function markStaleRunFailed(database: NorthstarQueryExecutor, state: DemoStateRow) {
  if (!asBoolean(state.reset_in_progress) || !state.active_reset_run_id) return state;
  const started = iso(state.last_reset_started_at);
  if (started && Date.now() - Date.parse(started) <= STALE_RESET_SECONDS * 1_000) return state;

  const completedAt = new Date().toISOString();
  await database.run(
    northstarSql({
      postgres: `UPDATE demo_reset_runs
                    SET status = 'FAILED', completed_at = now(), error_code = 'INTERRUPTED'
                  WHERE id = $1 AND status = 'RUNNING'`,
      sqlite: `UPDATE demo_reset_runs
                  SET status = 'FAILED', completed_at = ?, error_code = 'INTERRUPTED'
                WHERE id = ? AND status = 'RUNNING'`,
    }),
    database.provider === "postgres"
      ? [state.active_reset_run_id]
      : [completedAt, state.active_reset_run_id],
  );
  await database.run(
    northstarSql({
      postgres: `UPDATE demo_state
                    SET reset_in_progress = false, active_reset_run_id = NULL, updated_at = now()
                  WHERE singleton = true`,
      sqlite: `UPDATE demo_state
                  SET reset_in_progress = 0, active_reset_run_id = NULL, updated_at = ?
                WHERE singleton = 1`,
    }),
    database.provider === "postgres" ? [] : [completedAt],
  );
  return { ...state, reset_in_progress: false, active_reset_run_id: null };
}

type ResetReservation =
  | { kind: "replay"; result: NorthstarDemoResetResult }
  | { kind: "reserved"; runId: string }
  | { kind: "reject"; error: NorthstarDemoResetError };

async function reserveReset(
  idempotencyKey: string,
  actor: NorthstarUser,
): Promise<ResetReservation> {
  return northstarRepository.transaction(async (database) => {
    if (database.provider === "postgres") {
      const lock = await database.get<{ acquired: boolean }>(
        "SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired",
        [NORTHSTAR_DEMO_RESET_LOCK],
      );
      if (!lock?.acquired) throw new NorthstarDemoResetError("BUSY", 409, 5);
    }

    let state = await stateRow(database, true);
    if (!state) throw new NorthstarDemoResetError("TEMPLATES_UNAVAILABLE", 503);
    state = await markStaleRunFailed(database, state);

    const existing = await findRun(database, idempotencyKey);
    if (existing?.status === "SUCCEEDED") {
      return { kind: "replay", result: completedRunResult(existing) };
    }
    if (existing?.status === "RUNNING") {
      throw new NorthstarDemoResetError("IDEMPOTENCY_IN_PROGRESS", 409, 5);
    }
    if (existing?.status === "FAILED") {
      // Return instead of throwing so stale-run recovery performed above is
      // committed before the caller receives the terminal idempotency result.
      return {
        kind: "reject",
        error: new NorthstarDemoResetError("IDEMPOTENCY_FAILED", 409),
      };
    }

    if (asBoolean(state.reset_in_progress)) {
      throw new NorthstarDemoResetError("BUSY", 409, 5);
    }

    const remaining = retryAfter(state.cooldown_until);
    if (remaining > 0) throw new NorthstarDemoResetError("COOLDOWN", 429, remaining);

    const count = await templateRecordCount(database);
    const userCount = await database.get<{ count: number | string }>(
      northstarSql({
        postgres: "SELECT count(*)::integer AS count FROM northstar_demo_user_templates",
        sqlite: "SELECT count(*) AS count FROM northstar_demo_user_templates",
      }),
    );
    if (
      count !== EXPECTED_RECORD_COUNT ||
      Number(state.canonical_record_count) !== EXPECTED_RECORD_COUNT ||
      Number(userCount?.count || 0) !== EXPECTED_USER_COUNT
    ) {
      throw new NorthstarDemoResetError("TEMPLATES_UNAVAILABLE", 503);
    }

    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    await database.run(
      northstarSql({
        postgres: `INSERT INTO demo_reset_runs
          (id, idempotency_key, status, requested_by, requested_by_role, requested_session, metadata)
          VALUES ($1, $2, 'RUNNING', $3, $4, $5, $6::jsonb)`,
        sqlite: `INSERT INTO demo_reset_runs
          (id, idempotency_key, status, requested_by, requested_by_role, requested_session,
           requested_at, started_at, metadata)
          VALUES (?, ?, 'RUNNING', ?, ?, ?, ?, ?, ?)`,
      }),
      database.provider === "postgres"
        ? [runId, idempotencyKey, actor.name, actor.role, actor.session, JSON.stringify({ source: "web" })]
        : [
            runId,
            idempotencyKey,
            actor.name,
            actor.role,
            actor.session,
            startedAt,
            startedAt,
            JSON.stringify({ source: "web" }),
          ],
    );
    await database.run(
      northstarSql({
        postgres: `UPDATE demo_state
                      SET reset_in_progress = true, active_reset_run_id = $1,
                          last_reset_started_at = now(), updated_at = now()
                    WHERE singleton = true`,
        sqlite: `UPDATE demo_state
                    SET reset_in_progress = 1, active_reset_run_id = ?,
                        last_reset_started_at = ?, updated_at = ?
                  WHERE singleton = 1`,
      }),
      database.provider === "postgres" ? [runId] : [runId, startedAt, startedAt],
    );
    return { kind: "reserved", runId };
  });
}

async function applyPostgresReset(runId: string, actor: NorthstarUser) {
  return northstarRepository.transaction(async (database) => {
    await database.run("SELECT set_config('northstar.demo_reset', 'on', true)");
    const result = await database.get<{
      completed_generation: number | string;
      restored_record_count: number | string;
      reset_completed_at: string | Date;
    }>(
      "SELECT * FROM northstar_apply_demo_templates($1, $2, $3, $4, $5)",
      [runId, actor.name, actor.role, actor.session, cooldownSeconds()],
    );
    if (!result) throw new NorthstarDemoResetError("RESET_FAILED", 500);
    return {
      runId,
      generation: Number(result.completed_generation),
      recordCount: Number(result.restored_record_count),
      completedAt: iso(result.reset_completed_at) || new Date().toISOString(),
      replayed: false,
    } satisfies NorthstarDemoResetResult;
  });
}

async function resetSqliteSequences(database: NorthstarQueryExecutor) {
  const sequence = await database.get<{ found: number }>(
    "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'",
  );
  if (sequence) {
    await database.run(
      `DELETE FROM sqlite_sequence WHERE name IN
        ('users','records','record_relations','record_cost_lines','communications','tasks','notes','reports','report_records','northstar_sessions')`,
    );
  }
}

async function applySqliteReset(runId: string, actor: NorthstarUser) {
  return northstarRepository.transaction(async (database) => {
    const state = await stateRow(database);
    if (!state || state.active_reset_run_id !== runId || !asBoolean(state.reset_in_progress)) {
      throw new NorthstarDemoResetError("RESET_FAILED", 500);
    }

    for (const table of [
      "northstar_sessions",
      "report_records",
      "reports",
      "tasks",
      "communications",
      "notes",
      "record_cost_lines",
      "record_relations",
      "records",
      "users",
    ]) {
      await database.run(`DELETE FROM ${table}`);
    }
    await resetSqliteSequences(database);

    await database.run(`INSERT INTO users
      (email, name, role, password_hash, active, credential_version)
      SELECT email, name, role, password_hash, active, credential_version
        FROM northstar_demo_user_templates ORDER BY email`);
    await database.run(`INSERT INTO records
      (type, number, title, party, status, priority, owner, due_date, data)
      SELECT type, number, title, party, status, priority, owner, due_date, data
        FROM northstar_demo_record_templates ORDER BY number`);
    await database.run(`INSERT INTO record_relations
      (parent_number, child_number, relation_type)
      SELECT parent_number, child_number, relation_type
        FROM northstar_demo_relation_templates
       ORDER BY parent_number, child_number, relation_type`);
    await database.run(`INSERT INTO record_cost_lines
      (record_number, category, description, quantity, unit_cost, sort_order)
      SELECT record_number, category, description, quantity, unit_cost, sort_order
        FROM northstar_demo_cost_line_templates
       ORDER BY record_number, sort_order, category, description`);

    const completedAt = new Date().toISOString();
    const generation = Number(state.generation || 0) + 1;
    const cooldownUntil = new Date(Date.now() + cooldownSeconds() * 1_000).toISOString();
    await database.run(
      `UPDATE demo_state
          SET generation = ?, reset_in_progress = 0, active_reset_run_id = NULL,
              last_reset_completed_at = ?, last_reset_by = ?, cooldown_until = ?, updated_at = ?
        WHERE singleton = 1`,
      [generation, completedAt, actor.name, cooldownUntil, completedAt],
    );
    await database.run(
      `UPDATE demo_reset_runs
          SET status = 'SUCCEEDED', completed_at = ?, record_count = ?, generation = ?
        WHERE id = ? AND status = 'RUNNING'`,
      [completedAt, EXPECTED_RECORD_COUNT, generation, runId],
    );
    await database.run(
      `INSERT INTO northstar_meta(key, value, updated_at) VALUES('demo_seed', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
      [
        JSON.stringify({
          version: Number(state.seed_version || 0),
          anchorDate: dateOnly(state.anchor_date),
          recordCount: EXPECTED_RECORD_COUNT,
          generation,
          lastResetAt: completedAt,
        }),
        completedAt,
      ],
    );
    await database.run(
      `INSERT INTO audit_events
        (user, user_role, module, record_type, record_number, action, field_changed,
         previous_value, new_value, note, session_id)
       VALUES (?, ?, 'Administration', 'Demo Data', 'SYSTEM-DEMO', 'Demo data reset',
               'generation', ?, ?, ?, ?)`,
      [
        actor.name,
        actor.role,
        String(generation - 1),
        String(generation),
        "Canonical demo data restored; prior audit history retained.",
        actor.session,
      ],
    );
    return {
      runId,
      generation,
      recordCount: EXPECTED_RECORD_COUNT,
      completedAt,
      replayed: false,
    } satisfies NorthstarDemoResetResult;
  });
}

async function markResetFailed(runId: string) {
  const completedAt = new Date().toISOString();
  await northstarRepository.transaction(async (database) => {
    await database.run(
      northstarSql({
        postgres: `UPDATE demo_reset_runs
                      SET status = 'FAILED', completed_at = now(), error_code = 'RESET_FAILED'
                    WHERE id = $1 AND status = 'RUNNING'`,
        sqlite: `UPDATE demo_reset_runs
                    SET status = 'FAILED', completed_at = ?, error_code = 'RESET_FAILED'
                  WHERE id = ? AND status = 'RUNNING'`,
      }),
      database.provider === "postgres" ? [runId] : [completedAt, runId],
    );
    await database.run(
      northstarSql({
        postgres: `UPDATE demo_state
                      SET reset_in_progress = false, active_reset_run_id = NULL, updated_at = now()
                    WHERE singleton = true AND active_reset_run_id = $1`,
        sqlite: `UPDATE demo_state
                    SET reset_in_progress = 0, active_reset_run_id = NULL, updated_at = ?
                  WHERE singleton = 1 AND active_reset_run_id = ?`,
      }),
      database.provider === "postgres" ? [runId] : [completedAt, runId],
    );
  });
}

export async function resetNorthstarDemo(options: {
  idempotencyKey: string;
  actor: NorthstarUser;
}): Promise<NorthstarDemoResetResult> {
  const idempotencyKey = options.idempotencyKey.trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new NorthstarDemoResetError("INVALID_IDEMPOTENCY_KEY", 400);
  }

  const reservation = await reserveReset(idempotencyKey, options.actor);
  if (reservation.kind === "replay") return reservation.result;
  if (reservation.kind === "reject") throw reservation.error;

  try {
    return northstarRepository.provider === "postgres"
      ? await applyPostgresReset(reservation.runId, options.actor)
      : await applySqliteReset(reservation.runId, options.actor);
  } catch {
    await markResetFailed(reservation.runId).catch(() => {});
    throw new NorthstarDemoResetError("RESET_FAILED", 500);
  }
}

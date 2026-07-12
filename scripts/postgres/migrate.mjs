import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPostgresClient } from "./client.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = join(scriptDirectory, "..", "..", "db", "migrations");
const lockName = "northstar_schema_migrations_v1";

function checksum(content) {
  return createHash("sha256").update(content).digest("hex");
}
async function migrationFiles() {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /^\d+_[a-z0-9_]+\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  if (files.length === 0) {
    throw new Error(`No SQL migrations found in ${migrationsDirectory}.`);
  }
  return files;
}

const client = createPostgresClient("northstar-migrate");
let lockHeld = false;

try {
  await client.connect();
  await client.query("SELECT pg_advisory_lock(hashtext($1))", [lockName]);
  lockHeld = true;

  await client.query(`
    CREATE TABLE IF NOT EXISTS northstar_schema_migrations (
      name text PRIMARY KEY,
      checksum char(64) NOT NULL,
      execution_ms integer NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const appliedRows = await client.query(
    "SELECT name, checksum FROM northstar_schema_migrations ORDER BY name",
  );
  const applied = new Map(appliedRows.rows.map((row) => [row.name, row.checksum.trim()]));
  let appliedCount = 0;

  for (const name of await migrationFiles()) {
    const sql = await readFile(join(migrationsDirectory, name), "utf8");
    const digest = checksum(sql);
    const previousDigest = applied.get(name);

    if (previousDigest) {
      if (previousDigest !== digest) {
        throw new Error(
          `Migration ${name} changed after it was applied. Add a new migration instead of editing history.`,
        );
      }
      console.log(`already applied ${name}`);
      continue;
    }

    const startedAt = Date.now();
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        `INSERT INTO northstar_schema_migrations (name, checksum, execution_ms)
         VALUES ($1, $2, $3)`,
        [name, digest, Date.now() - startedAt],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    appliedCount += 1;
    console.log(`applied ${name}`);
  }

  console.log(
    appliedCount === 0
      ? "PostgreSQL schema is current."
      : `Applied ${appliedCount} PostgreSQL migration${appliedCount === 1 ? "" : "s"}.`,
  );
} catch (error) {
  console.error("PostgreSQL migration failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (lockHeld) {
    try {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockName]);
    } catch {
      // The connection closing also releases a session-level advisory lock.
    }
  }
  await client.end().catch(() => {});
}

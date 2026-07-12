import pg from "pg";

const { Client } = pg;

export function requireDatabaseUrl() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is required. Configure the web service with its PostgreSQL private connection string.",
    );
  }

  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL.");
  }

  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    throw new Error("DATABASE_URL must use the postgres:// or postgresql:// protocol.");
  }

  return connectionString;
}
export function createPostgresClient(applicationName) {
  return new Client({
    connectionString: requireDatabaseUrl(),
    application_name: applicationName,
    connectionTimeoutMillis: 15_000,
    query_timeout: 120_000,
    statement_timeout: 120_000,
  });
}

# Northstar PostgreSQL foundation

The SQL in `db/migrations` is the production schema. Migrations are immutable once applied; add a new numbered SQL file for every later change.

The Next.js application uses PostgreSQL whenever `DATABASE_URL` is configured. SQLite remains an isolated fallback for local development and tests.

The PostgreSQL driver and package scripts are included in the application:

```json
{
  "db:migrate:postgres": "node scripts/postgres/migrate.mjs",
  "db:seed:postgres": "node scripts/postgres/seed.mjs",
  "db:reset:postgres": "ALLOW_DEMO_RESET=1 node scripts/postgres/seed.mjs --reset"
}
```

Run migrations before every production deployment. The seed is idempotent and safely exits without changing an already-seeded database.

```bash
DATABASE_URL='postgresql://…' npm run db:migrate:postgres
DATABASE_URL='postgresql://…' npm run db:seed:postgres
```

`NORTHSTAR_DEMO_DATE=YYYY-MM-DD` pins relative due dates. `NORTHSTAR_DEMO_PASSWORD` overrides the public demo password. The web reset requires an administrator session, the exact typed confirmation phrase, and a separate 24+ character `NORTHSTAR_OPERATOR_RESET_TOKEN`; keep that token only in the deployment environment. `NORTHSTAR_DEMO_RESET_COOLDOWN_SECONDS` controls the reset cooldown. The CLI reset still requires both `--reset` and `ALLOW_DEMO_RESET=1`.

The reset restores canonical template rows inside a locked database transaction, revokes all sessions, and clears mutable reports, tasks, notes, and communications. Reset-run evidence and the append-only audit history are intentionally retained.

`render.yaml` runs the migration and idempotent seed as the web service's pre-deploy command, then verifies `/api/health` before routing traffic. Its `DATABASE_URL` references the Render PostgreSQL private connection string. The database is not exposed to the public internet.

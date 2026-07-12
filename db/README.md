# Northstar PostgreSQL foundation

The SQL in `db/migrations` is the production schema. Migrations are immutable once applied; add a new numbered SQL file for every later change.

The current Next.js routes still use SQLite. These scripts are deliberately opt-in until the application data adapter is converted to asynchronous PostgreSQL queries.

The PostgreSQL driver and package scripts are included in the application:

```json
{
  "db:migrate:postgres": "node scripts/postgres/migrate.mjs",
  "db:seed:postgres": "node scripts/postgres/seed.mjs",
  "db:reset:postgres": "ALLOW_DEMO_RESET=1 node scripts/postgres/seed.mjs --reset"
}
```

Run migrations before every production deployment. Seed once after provisioning; never seed automatically during normal deploys.

```bash
DATABASE_URL='postgresql://…' npm run db:migrate:postgres
DATABASE_URL='postgresql://…' npm run db:seed:postgres
```

`NORTHSTAR_DEMO_DATE=YYYY-MM-DD` pins relative due dates. `NORTHSTAR_DEMO_PASSWORD` overrides the public demo password. A destructive reset requires both `--reset` and `ALLOW_DEMO_RESET=1`.

After all routes use PostgreSQL, add this to `railway.json` and remove the web-service SQLite volume/bootstrap path:

```json
{
  "deploy": {
    "preDeployCommand": ["npm run db:migrate:postgres"],
    "healthcheckPath": "/api/health"
  }
}
```

Set the web service's `DATABASE_URL` to Railway's private reference value `${{Postgres.DATABASE_URL}}`. The Postgres service owns its persistent volume; the Next.js web service should not mount one.

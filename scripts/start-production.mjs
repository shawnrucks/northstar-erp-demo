import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

if (!process.env.DATABASE_URL) {
  const databasePath = resolve(process.env.NORTHSTAR_DATABASE_PATH || "/data/northstar.sqlite3");
  mkdirSync(dirname(databasePath), { recursive: true });
  if (!existsSync(databasePath)) {
    const setup = spawnSync(process.execPath, ["scripts/northstar-setup.mjs"], {
      env: { ...process.env, NORTHSTAR_DATABASE_PATH: databasePath },
      stdio: "inherit",
    });
    if (setup.status !== 0) process.exit(setup.status || 1);
  }
}

const server = spawnSync(process.execPath, [".next/standalone/server.js"], {
  env: process.env,
  stdio: "inherit",
});
process.exit(server.status || 0);

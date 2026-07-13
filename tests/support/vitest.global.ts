import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

export default function setup() {
  const projectRoot = process.cwd();
  const testRoot = path.join(projectRoot, ".test-data/vitest");

  rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  mkdirSync(testRoot, { recursive: true });
  execFileSync(
    process.execPath,
    [path.join(projectRoot, "scripts/northstar-setup.mjs")],
    {
      cwd: testRoot,
      env: {
        ...process.env,
        NORTHSTAR_ADMIN_PASSWORD: "Demo123!",
        NORTHSTAR_DATABASE_PATH: path.join(testRoot, "data/northstar.sqlite3"),
      },
      stdio: "ignore",
    },
  );
}

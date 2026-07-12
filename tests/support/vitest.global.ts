import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

export default function setup() {
  const projectRoot = process.cwd();
  const testRoot = path.join(projectRoot, ".test-data/vitest");

  rmSync(testRoot, { recursive: true, force: true });
  mkdirSync(testRoot, { recursive: true });
  execFileSync(
    process.execPath,
    [path.join(projectRoot, "scripts/northstar-setup.mjs")],
    {
      cwd: testRoot,
      env: {
        ...process.env,
        NORTHSTAR_DATABASE_PATH: path.join(testRoot, "data/northstar.sqlite3"),
      },
      stdio: "ignore",
    },
  );
}

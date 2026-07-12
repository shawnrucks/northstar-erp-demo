import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const testRoot = path.join(projectRoot, ".test-data/playwright");
const databasePath = path.join(testRoot, "data/northstar.sqlite3");
const port = process.env.NORTHSTAR_E2E_PORT || "3100";

rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
mkdirSync(testRoot, { recursive: true });
execFileSync(
  process.execPath,
  [path.join(projectRoot, "scripts/northstar-setup.mjs")],
  { cwd: testRoot, stdio: "inherit" },
);

const nextBin = path.join(projectRoot, "node_modules/next/dist/bin/next");
const server = spawn(process.execPath, [nextBin, "dev", "--webpack", "-p", port], {
  cwd: projectRoot,
  env: {
    ...process.env,
    NORTHSTAR_DATABASE_PATH: databasePath,
    NORTHSTAR_NEXT_DIST_DIR: ".next-e2e",
  },
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.kill(signal));
}

server.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

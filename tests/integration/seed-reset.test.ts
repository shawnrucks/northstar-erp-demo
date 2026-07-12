import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const resetRoot = path.join(projectRoot, `.test-data/seed-reset-${process.pid}`);
const setupScript = path.join(projectRoot, "scripts/northstar-setup.mjs");
const databasePath = path.join(resetRoot, "data/northstar.sqlite3");

function reset() {
  execFileSync(process.execPath, [setupScript], {
    cwd: resetRoot,
    env: { ...process.env, NORTHSTAR_DATABASE_PATH: databasePath },
    stdio: "ignore",
  });
}

describe("Northstar seed reset", () => {
  beforeAll(() => {
    mkdirSync(resetRoot, { recursive: true });
    reset();
  });

  afterAll(() => {
    rmSync(resetRoot, { recursive: true, force: true });
  });

  it("creates the required deterministic fixture volumes", () => {
    const db = new Database(databasePath, { readonly: true });
    const count = (table: string) =>
      (db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number })
        .count;

    expect(count("users")).toBe(7);
    expect(count("records")).toBe(2090);
    expect(count("audit_events")).toBe(300);
    expect(
      (
        db
          .prepare("SELECT count(*) AS count FROM records WHERE type='SUPPLIER'")
          .get() as { count: number }
      ).count,
    ).toBe(140);
    expect(
      (
        db
          .prepare("SELECT count(*) AS count FROM records WHERE type='INVENTORY_BALANCE'")
          .get() as { count: number }
      ).count,
    ).toBe(1000);
    db.close();
  });

  it("removes mutations and restores the connected demo scenario", () => {
    const db = new Database(databasePath);
    db.prepare("UPDATE records SET status='CORRUPTED' WHERE number='RFQ-2026-1047'").run();
    db.prepare("DELETE FROM records WHERE number='PO-10482'").run();
    db.close();

    reset();

    const restored = new Database(databasePath, { readonly: true });
    expect(
      restored
        .prepare("SELECT status FROM records WHERE number='RFQ-2026-1047'")
        .pluck()
        .get(),
    ).toBe("MISSING_INFORMATION");
    expect(
      restored
        .prepare("SELECT count(*) FROM records WHERE number='PO-10482'")
        .pluck()
        .get(),
    ).toBe(1);
    restored.close();
  });
});

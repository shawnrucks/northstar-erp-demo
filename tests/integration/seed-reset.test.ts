import { execFileSync } from "node:child_process";
import { scryptSync } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const resetRoot = path.join(projectRoot, `.test-data/seed-reset-${process.pid}`);
const setupScript = path.join(projectRoot, "scripts/northstar-setup.mjs");
const databasePath = path.join(resetRoot, "data/northstar.sqlite3");

function reset(environment: Record<string, string> = {}) {
  execFileSync(process.execPath, [setupScript], {
    cwd: resetRoot,
    env: {
      ...process.env,
      NORTHSTAR_ADMIN_PASSWORD: "Demo123!",
      NORTHSTAR_DATABASE_PATH: databasePath,
      ...environment,
    },
    stdio: "ignore",
  });
}

function passwordMatches(password: string, stored: string) {
  const [salt, digest] = stored.split(":");
  return scryptSync(password, salt, 64).toString("hex") === digest;
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

  it("keeps the administrator password owner-only without changing public accounts", () => {
    const ownerPassword = "OwnerOnly-Integration-Password-2026!";
    reset({ NORTHSTAR_ADMIN_PASSWORD: ownerPassword });

    const db = new Database(databasePath, { readonly: true });
    for (const table of ["users", "northstar_demo_user_templates"]) {
      const adminHash = db
        .prepare(`SELECT password_hash FROM ${table} WHERE email='admin@northstar-demo.com'`)
        .pluck()
        .get() as string;
      const buyerHash = db
        .prepare(`SELECT password_hash FROM ${table} WHERE email='buyer@northstar-demo.com'`)
        .pluck()
        .get() as string;

      expect(passwordMatches(ownerPassword, adminHash)).toBe(true);
      expect(passwordMatches("Demo123!", adminHash)).toBe(false);
      expect(passwordMatches("Demo123!", buyerHash)).toBe(true);
    }
    db.close();
    reset();
  });
});

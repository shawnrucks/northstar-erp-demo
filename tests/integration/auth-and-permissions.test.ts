import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { POST as login } from "@/app/api/northstar/login/route";
import { POST as takeAction } from "@/app/api/northstar/action/route";
import { nsdb } from "@/lib/northstar";
import { authenticateNorthstarRequest } from "@/lib/northstar-auth";

type Snapshot = { number: string; status: string; data: string };
let snapshots: Snapshot[] = [];

const users = {
  admin: {
    email: "admin@northstar-demo.com",
    name: "Morgan Hayes",
    role: "ADMIN",
  },
  sales: {
    email: "sales@northstar-demo.com",
    name: "Elena Torres",
    role: "SALES_COORDINATOR",
  },
  buyer: {
    email: "buyer@northstar-demo.com",
    name: "Caleb Wright",
    role: "BUYER",
  },
  planner: {
    email: "planner@northstar-demo.com",
    name: "Priya Shah",
    role: "PRODUCTION_PLANNER",
  },
  operations: {
    email: "operations@northstar-demo.com",
    name: "Taylor Reed",
    role: "OPERATIONS_ANALYST",
  },
  ap: {
    email: "ap@northstar-demo.com",
    name: "Nina Foster",
    role: "ACCOUNTS_PAYABLE",
  },
} as const;

function jsonRequest(url: string, body: object, cookie?: string) {
  const headers = new Headers({
    "content-type": "application/json",
    origin: "http://northstar.test",
  });
  if (cookie) headers.set("cookie", cookie);
  return new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function loginAs(user: (typeof users)[keyof typeof users]) {
  const response = await login(
    jsonRequest("http://northstar.test/api/northstar/login", {
      email: user.email,
      password: "Demo123!",
    }),
  );
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")?.match(/ns_session=[^;]+/)?.[0];
  expect(cookie).toBeTruthy();
  return cookie!;
}

async function action(
  user: (typeof users)[keyof typeof users] | null,
  body: Record<string, unknown>,
) {
  const cookie = user ? await loginAs(user) : undefined;
  return takeAction(
    jsonRequest("http://northstar.test/api/northstar/action", body, cookie),
  );
}

describe("login and action authorization", () => {
  beforeAll(() => {
    snapshots = nsdb
      .prepare(
        "SELECT number,status,data FROM records WHERE number IN ('QT-2026-1047','PO-10482','MS-3021','INV-SUM-8821')",
      )
      .all() as Snapshot[];
  });

  afterEach(() => {
    const restore = nsdb.prepare(
      "UPDATE records SET status=?,data=? WHERE number=?",
    );
    const tx = nsdb.transaction(() => {
      for (const snapshot of snapshots) {
        restore.run(snapshot.status, snapshot.data, snapshot.number);
      }
      nsdb
        .prepare(
          "DELETE FROM communications WHERE record_number IN ('QT-2026-1047','PO-10482','MS-3021','INV-SUM-8821')",
        )
        .run();
      nsdb
        .prepare(
          "DELETE FROM tasks WHERE record_number IN ('QT-2026-1047','PO-10482','MS-3021','INV-SUM-8821')",
        )
        .run();
      nsdb.prepare("DELETE FROM audit_events WHERE session_id != 'seed-session'").run();
      nsdb.prepare("DELETE FROM northstar_sessions").run();
    });
    tx();
  });

  it("accepts a seeded credential and emits an opaque HttpOnly session cookie", async () => {
    const response = await login(
      jsonRequest("http://northstar.test/api/northstar/login", {
        email: users.operations.email,
        password: "Demo123!",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("ns_session=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).not.toContain(users.operations.email);
  });

  it("rejects an invalid password without setting a session", async () => {
    const response = await login(
      jsonRequest("http://northstar.test/api/northstar/login", {
        email: users.operations.email,
        password: "incorrect",
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("resolves the opaque session through the repository", async () => {
    const cookie = await loginAs(users.operations);
    const request = new Request("http://northstar.test/erp/dashboard", {
      headers: { cookie },
    });

    await expect(authenticateNorthstarRequest(request)).resolves.toMatchObject({
      email: users.operations.email,
      name: users.operations.name,
      role: users.operations.role,
    });
  });

  it("requires authentication for every mutation", async () => {
    const response = await action(null, {
      number: "QT-2026-1047",
      action: "approve",
    });
    expect(response.status).toBe(401);
  });

  it.each([users.sales, users.operations])(
    "prevents $role from approving a quote",
    async (user) => {
      const response = await action(user, {
        number: "QT-2026-1047",
        action: "approve",
      });
      expect(response.status).toBe(403);
      expect(
        nsdb
          .prepare("SELECT status FROM records WHERE number='QT-2026-1047'")
          .pluck()
          .get(),
      ).toBe("AWAITING_APPROVAL");
    },
  );

  it("allows an administrator to approve a quote and records the audit event", async () => {
    const before = nsdb
      .prepare(
        "SELECT count(*) FROM audit_events WHERE record_number='QT-2026-1047' AND action='approve'",
      )
      .pluck()
      .get() as number;
    const response = await action(users.admin, {
      number: "QT-2026-1047",
      action: "approve",
    });

    expect(response.status).toBe(200);
    expect(
      nsdb
        .prepare("SELECT status FROM records WHERE number='QT-2026-1047'")
        .pluck()
        .get(),
    ).toBe("APPROVED");
    expect(
      nsdb
        .prepare(
          "SELECT count(*) FROM audit_events WHERE record_number='QT-2026-1047' AND action='approve'",
        )
        .pluck()
        .get(),
    ).toBe(before + 1);
  });

  it.each([
    [users.buyer, "PO-10482", "supplierFollowup"],
    [users.planner, "MS-3021", "transfer"],
    [users.ap, "INV-SUM-8821", "invoiceHold"],
  ] as const)("allows an authorized role to perform %s", async (user, number, actionName) => {
    const response = await action(user, {
      number,
      action: actionName,
      recipient: "vitest@supplier.example",
      message: "vitest permission check",
      from: "Fort Collins Fabrication",
      quantity: 2200,
    });
    expect(response.status).toBe(200);
  });

  it.each([
    [users.operations, "PO-10482", "supplierFollowup"],
    [users.sales, "MS-3021", "transfer"],
    [users.buyer, "INV-SUM-8821", "invoiceHold"],
  ] as const)("denies an unauthorized role permission to perform %s", async (user, number, actionName) => {
    const response = await action(user, {
      number,
      action: actionName,
    });
    expect(response.status).toBe(403);
  });
});

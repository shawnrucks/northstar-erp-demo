import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { POST as login } from "@/app/api/northstar/login/route";
import { POST as takeAction } from "@/app/api/northstar/action/route";
import { nsdb } from "@/lib/northstar";
import { authenticateNorthstarRequest, createNorthstarSession, type NorthstarCredentialUser } from "@/lib/northstar-auth";

type Snapshot = {
  number: string;
  status: string;
  data: string;
  party: string;
  title: string;
  owner: string;
  due_date: string | null;
};
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

function jsonRequest(url: string, body: object, cookie?: string, idempotencyKey = crypto.randomUUID()) {
  const headers = new Headers({
    "content-type": "application/json",
    "idempotency-key": idempotencyKey,
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
        "SELECT number,status,data,party,title,owner,due_date FROM records WHERE number IN ('RFQ-2026-1047','QT-2026-1047','PO-10482','MS-3021','INV-SUM-8821')",
      )
      .all() as Snapshot[];
  });

  afterEach(() => {
    const restore = nsdb.prepare(
      "UPDATE records SET status=?,data=?,party=?,title=?,owner=?,due_date=? WHERE number=?",
    );
    const tx = nsdb.transaction(() => {
      for (const snapshot of snapshots) {
        restore.run(snapshot.status, snapshot.data, snapshot.party, snapshot.title, snapshot.owner, snapshot.due_date, snapshot.number);
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
      nsdb.prepare("DELETE FROM records WHERE number='MS-VITEST-SHARED'").run();
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

  it("refuses to create a session from credentials changed after authentication", async () => {
    const credential = nsdb
      .prepare("SELECT id,email,name,role,password_hash FROM users WHERE email=?")
      .get(users.admin.email) as NorthstarCredentialUser;
    const replacement = `changed:${"a".repeat(128)}`;
    nsdb.prepare("UPDATE users SET password_hash=? WHERE id=?").run(replacement, credential.id);
    try {
      await expect(
        createNorthstarSession(
          credential,
          new Request("http://northstar.test/api/northstar/login"),
        ),
      ).rejects.toThrow(/account changed/i);
    } finally {
      nsdb
        .prepare("UPDATE users SET password_hash=? WHERE id=?")
        .run(credential.password_hash, credential.id);
    }
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

  it("replays the same action idempotently without duplicating side effects", async () => {
    const cookie = await loginAs(users.buyer);
    const key = "vitest-action-idempotency-0001";
    const body = {
      number: "PO-10482",
      action: "supplierFollowup",
      recipient: "vitest@supplier.example",
      message: "Send this follow-up only once.",
    };
    const before = nsdb
      .prepare("SELECT count(*) FROM communications WHERE record_number='PO-10482'")
      .pluck()
      .get() as number;

    const first = await takeAction(
      jsonRequest("http://northstar.test/api/northstar/action", body, cookie, key),
    );
    const replay = await takeAction(
      jsonRequest("http://northstar.test/api/northstar/action", body, cookie, key),
    );

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    expect(
      nsdb
        .prepare("SELECT count(*) FROM communications WHERE record_number='PO-10482'")
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
      to: "Denver Manufacturing",
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

  it("rejects an RFQ transition when required business fields are omitted", async () => {
    const response = await action(users.sales, {
      number: "RFQ-2026-1047",
      action: "updateRfq",
      drawingRevision: "C",
      packaging: "25 units per reinforced carton",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "customer is required.",
    });
    expect(
      nsdb
        .prepare("SELECT status FROM records WHERE number='RFQ-2026-1047'")
        .pluck()
        .get(),
    ).toBe("MISSING_INFORMATION");
  });

  it("keeps RFQ list fields synchronized with edited required data", async () => {
    const response = await action(users.sales, {
      number: "RFQ-2026-1047",
      action: "updateRfq",
      customer: "Updated Apex Motion",
      item: "NS-BR-442",
      itemDescription: "Updated mounting bracket",
      quantity: 2_750,
      requestedDelivery: "2026-09-15",
      quoteDueDate: "2026-07-20",
      material: "A36 carbon steel",
      drawingNumber: "AMS-442",
      drawingRevision: "D",
      packaging: "20 units per reinforced carton",
      assignedEstimator: "Elena Torres",
    });
    expect(response.status).toBe(200);
    expect(
      nsdb.prepare(`SELECT party,title,owner,due_date,status FROM records
                     WHERE number='RFQ-2026-1047'`).get(),
    ).toMatchObject({
      party: "Updated Apex Motion",
      title: "Updated mounting bracket",
      owner: "Elena Torres",
      due_date: "2026-07-20",
      status: "COSTING",
    });
  });

  it("auto-approves a quote when the configured margin needs no approval", async () => {
    const rfq = nsdb
      .prepare("SELECT data FROM records WHERE number='RFQ-2026-1047'")
      .pluck()
      .get() as string;
    nsdb
      .prepare("UPDATE records SET data=? WHERE number='RFQ-2026-1047'")
      .run(JSON.stringify({ ...JSON.parse(rfq), drawingRevision: "C" }));
    nsdb
      .prepare("UPDATE records SET status='DRAFT', data=? WHERE number='QT-2026-1047'")
      .run(JSON.stringify({
        rfq: "RFQ-2026-1047",
        materialCost: 100,
        outsideProcessing: 0,
        laborHours: 0,
        laborRate: 0,
        machineHours: 0,
        machineRate: 0,
        setupCost: 0,
        toolingCost: 0,
        packagingCost: 0,
        freight: 0,
        scrapPct: 0,
        overhead: 0,
        revenue: 1_000,
      }));

    const response = await action(users.sales, {
      number: "QT-2026-1047",
      action: "submitApproval",
    });

    expect(response.status).toBe(200);
    expect(
      nsdb
        .prepare("SELECT status FROM records WHERE number='QT-2026-1047'")
        .pluck()
        .get(),
    ).toBe("APPROVED");
  });

  it("requires production-planner approval for a below-standard lead time", async () => {
    const rfq = nsdb
      .prepare("SELECT data FROM records WHERE number='RFQ-2026-1047'")
      .pluck()
      .get() as string;
    nsdb
      .prepare("UPDATE records SET data=? WHERE number='RFQ-2026-1047'")
      .run(JSON.stringify({ ...JSON.parse(rfq), drawingRevision: "C" }));
    nsdb
      .prepare("UPDATE records SET status='DRAFT', data=? WHERE number='QT-2026-1047'")
      .run(JSON.stringify({
        rfq: "RFQ-2026-1047",
        materialCost: 900,
        revenue: 1_000,
        leadTimeDays: 10,
        standardLeadTimeDays: 30,
      }));

    const response = await action(users.sales, {
      number: "QT-2026-1047",
      action: "submitApproval",
    });
    expect(response.status).toBe(200);
    const quote = nsdb
      .prepare("SELECT status,data FROM records WHERE number='QT-2026-1047'")
      .get() as { status: string; data: string };
    expect(quote.status).toBe("AWAITING_APPROVAL");
    expect(JSON.parse(quote.data).approval).toContain("PRODUCTION_PLANNER");

    const plannerApproval = await action(users.planner, {
      number: "QT-2026-1047",
      action: "plannerApprove",
    });
    expect(plannerApproval.status).toBe(200);
    expect(
      nsdb
        .prepare("SELECT status FROM records WHERE number='QT-2026-1047'")
        .pluck()
        .get(),
    ).toBe("AWAITING_APPROVAL");

    const duplicatePlannerApproval = await action(users.planner, {
      number: "QT-2026-1047",
      action: "plannerApprove",
    });
    expect(duplicatePlannerApproval.status).toBe(409);

    const commercialApproval = await action(users.admin, {
      number: "QT-2026-1047",
      action: "approve",
    });
    expect(commercialApproval.status).toBe(200);
    expect(
      nsdb
        .prepare("SELECT status FROM records WHERE number='QT-2026-1047'")
        .pluck()
        .get(),
    ).toBe("APPROVED");
  });

  it("does not reopen a submitted quote through Create Quote", async () => {
    nsdb.prepare("UPDATE records SET status='COSTING' WHERE number='RFQ-2026-1047'").run();
    nsdb.prepare("UPDATE records SET status='SUBMITTED' WHERE number='QT-2026-1047'").run();

    const response = await action(users.sales, {
      number: "RFQ-2026-1047",
      action: "createQuote",
      quoteNumber: "QT-2026-1047",
      revenue: 88_188,
      leadTimeDays: 30,
    });
    expect(response.status).toBe(400);
    expect(
      nsdb
        .prepare("SELECT status FROM records WHERE number='QT-2026-1047'")
        .pluck()
        .get(),
    ).toBe("SUBMITTED");
  });

  it("reserves transferred inventory and blocks cumulative over-allocation", async () => {
    const first = await action(users.planner, {
      number: "MS-3021",
      action: "transfer",
      from: "Fort Collins Fabrication",
      to: "Denver Manufacturing",
      quantity: 2_200,
    });
    expect(first.status).toBe(200);

    const second = await action(users.planner, {
      number: "MS-3021",
      action: "transfer",
      from: "Fort Collins Fabrication",
      to: "Denver Manufacturing",
      quantity: 1,
    });
    expect(second.status).toBe(400);
    await expect(second.json()).resolves.toMatchObject({
      error: "Only 0 LB is available at Fort Collins Fabrication.",
    });

    nsdb.prepare(`INSERT INTO records
      (type,number,title,party,status,priority,owner,due_date,data)
      VALUES('SHORTAGE','MS-VITEST-SHARED','Shared A36 shortage','Test customer',
             'OPEN','HIGH','Priya Shah','2026-07-20',?)`).run(JSON.stringify({
      item: "A36 Steel Sheet",
      denver: 0,
      fortCollins: 2_200,
      aurora: 0,
    }));
    const crossShortage = await action(users.planner, {
      number: "MS-VITEST-SHARED",
      action: "transfer",
      from: "Fort Collins Fabrication",
      to: "Denver Manufacturing",
      quantity: 1,
    });
    expect(crossShortage.status).toBe(400);
    await expect(crossShortage.json()).resolves.toMatchObject({
      error: "Only 0 LB is available at Fort Collins Fabrication.",
    });
  });
});

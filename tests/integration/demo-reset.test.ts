import { afterEach, describe, expect, it } from "vitest";

import { POST as login } from "@/app/api/northstar/login/route";
import { POST as takeAction } from "@/app/api/northstar/action/route";
import { POST as saveReport } from "@/app/api/northstar/reports/route";
import {
  GET as resetStatus,
  POST as resetDemo,
} from "@/app/api/northstar/admin/reset/route";
import { nsdb } from "@/lib/northstar";

function request(
  url: string,
  body: Record<string, unknown>,
  cookie?: string,
) {
  const headers = new Headers({
    "content-type": "application/json",
    origin: "http://northstar.test",
  });
  if (url.endsWith("/action") || url.endsWith("/reports")) {
    headers.set("idempotency-key", crypto.randomUUID());
  }
  if (cookie) headers.set("cookie", cookie);
  return new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function loginAs(email: string) {
  const response = await login(
    request("http://northstar.test/api/northstar/login", {
      email,
      password: "Demo123!",
    }),
  );
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")?.match(/ns_session=[^;]+/)?.[0];
  expect(cookie).toBeTruthy();
  return cookie!;
}

function resetRequest(cookie: string, overrides: Record<string, unknown> = {}) {
  return resetDemo(
    request(
      "http://northstar.test/api/northstar/admin/reset",
      {
        idempotencyKey: "integration-reset-0001",
        ...overrides,
      },
      cookie,
    ),
  );
}

describe("controlled demo reset", () => {
  afterEach(() => {
    nsdb.prepare("DELETE FROM demo_reset_runs").run();
    nsdb.prepare(`UPDATE demo_state
      SET generation=0, reset_in_progress=0, active_reset_run_id=NULL,
          last_reset_started_at=NULL, last_reset_completed_at=NULL,
          last_reset_by=NULL, cooldown_until=NULL`).run();
    nsdb.prepare("DELETE FROM audit_events WHERE session_id <> 'seed-session'").run();
    nsdb.prepare("DELETE FROM northstar_sessions").run();
  });

  it("requires an authenticated administrator and a protected request context", async () => {
    expect(
      (
        await resetStatus(
          new Request("http://northstar.test/api/northstar/admin/reset"),
        )
      ).status,
    ).toBe(401);
    expect((await resetRequest("", {})).status).toBe(401);

    const buyerCookie = await loginAs("buyer@northstar-demo.com");
    expect(
      (
        await resetStatus(
          new Request("http://northstar.test/api/northstar/admin/reset", {
            headers: { cookie: buyerCookie },
          }),
        )
      ).status,
    ).toBe(403);
    expect((await resetRequest(buyerCookie)).status).toBe(403);

    const adminCookie = await loginAs("admin@northstar-demo.com");
    const crossOrigin = new Request(
      "http://northstar.test/api/northstar/admin/reset",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
          origin: "https://untrusted.example",
          "idempotency-key": "integration-reset-cross-origin",
        },
        body: "{}",
      },
    );
    expect((await resetDemo(crossOrigin)).status).toBe(403);

    const nonJson = new Request(
      "http://northstar.test/api/northstar/admin/reset",
      {
        method: "POST",
        headers: {
          cookie: adminCookie,
          origin: "http://northstar.test",
          "idempotency-key": "integration-reset-non-json",
        },
        body: "reset",
      },
    );
    expect((await resetDemo(nonJson)).status).toBe(415);
    expect(
      (
        await resetDemo(
          request("http://northstar.test/api/northstar/admin/reset", {}, adminCookie),
        )
      ).status,
    ).toBe(400);
  });

  it("recovers an interrupted reset before rejecting reuse of its idempotency key", async () => {
    const adminCookie = await loginAs("admin@northstar-demo.com");
    const staleTime = new Date(Date.now() - 20 * 60 * 1_000).toISOString();
    nsdb.prepare(`INSERT INTO demo_reset_runs
      (id,idempotency_key,status,requested_by,requested_by_role,requested_session,
       requested_at,started_at,metadata)
      VALUES('stale-run-id','stale-reset-0001','RUNNING','Morgan Hayes','ADMIN',
             'stale-session',?,?, '{}')`).run(staleTime, staleTime);
    nsdb.prepare(`UPDATE demo_state
      SET reset_in_progress=1, active_reset_run_id='stale-run-id',
          last_reset_started_at=?, updated_at=?`).run(staleTime, staleTime);

    const response = await resetRequest(adminCookie, {
      idempotencyKey: "stale-reset-0001",
    });
    expect(response.status).toBe(409);
    expect(
      nsdb.prepare("SELECT status FROM demo_reset_runs WHERE id='stale-run-id'").pluck().get(),
    ).toBe("FAILED");
    expect(nsdb.prepare("SELECT reset_in_progress FROM demo_state").pluck().get()).toBe(0);
  });

  it("rejects login and workflow mutations while a reset reservation is active", async () => {
    const adminCookie = await loginAs("admin@northstar-demo.com");
    const startedAt = new Date().toISOString();
    nsdb.prepare(`INSERT INTO demo_reset_runs
      (id,idempotency_key,status,requested_by,requested_by_role,requested_session,
       requested_at,started_at,metadata)
      VALUES('active-run-id','active-reset-0001','RUNNING','Morgan Hayes','ADMIN',
             'active-session',?,?, '{}')`).run(startedAt, startedAt);
    nsdb.prepare(`UPDATE demo_state
      SET reset_in_progress=1, active_reset_run_id='active-run-id',
          last_reset_started_at=?, updated_at=?`).run(startedAt, startedAt);

    const actionResponse = await takeAction(
      request(
        "http://northstar.test/api/northstar/action",
        { number: "QT-2026-1047", action: "approve" },
        adminCookie,
      ),
    );
    expect(actionResponse.status).toBe(409);
    await expect(actionResponse.json()).resolves.toMatchObject({
      code: "DEMO_RESET_IN_PROGRESS",
    });

    const reportResponse = await saveReport(
      request(
        "http://northstar.test/api/northstar/reports",
        { number: "DOR-RESET-GUARD", executiveSummary: "Must not save." },
        adminCookie,
      ),
    );
    expect(reportResponse.status).toBe(409);

    const loginResponse = await login(
      request("http://northstar.test/api/northstar/login", {
        email: "admin@northstar-demo.com",
        password: "Demo123!",
      }),
    );
    expect(loginResponse.status).toBe(503);
  });

  it("restores canonical rows, clears transient work, preserves audit, revokes sessions, and replays safely", async () => {
    const adminCookie = await loginAs("admin@northstar-demo.com");
    nsdb.prepare("UPDATE records SET status='APPROVED' WHERE number='PO-10482'").run();
    nsdb.prepare(`INSERT INTO tasks
      (number,title,record_number,assigned_user,created_by,priority,status,note)
      VALUES('TASK-RESET-TEST','Transient task','PO-10482','Morgan Hayes','Morgan Hayes','NORMAL','OPEN','')`).run();
    nsdb.prepare(`INSERT INTO audit_events
      (user,user_role,module,record_type,record_number,action,note,session_id)
      VALUES('Morgan Hayes','ADMIN','Administration','Demo Data','SYSTEM-DEMO','Pre-reset marker','test marker','must-survive')`).run();

    const response = await resetRequest(adminCookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      generation: 1,
      recordCount: 2090,
      replayed: false,
    });
    expect(response.headers.get("set-cookie")).toContain("ns_session=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(nsdb.prepare("SELECT count(*) FROM records").pluck().get()).toBe(2090);
    expect(
      nsdb.prepare("SELECT status FROM records WHERE number='PO-10482'").pluck().get(),
    ).toBe("AWAITING_CONFIRMATION");
    expect(
      nsdb.prepare("SELECT count(*) FROM tasks WHERE number='TASK-RESET-TEST'").pluck().get(),
    ).toBe(0);
    expect(
      nsdb.prepare("SELECT count(*) FROM audit_events WHERE session_id='must-survive'").pluck().get(),
    ).toBe(1);
    expect(
      nsdb.prepare("SELECT count(*) FROM audit_events WHERE action='Demo data reset'").pluck().get(),
    ).toBe(1);
    expect(nsdb.prepare("SELECT count(*) FROM northstar_sessions").pluck().get()).toBe(0);

    const newAdminCookie = await loginAs("admin@northstar-demo.com");
    const replay = await resetRequest(newAdminCookie);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ ok: true, replayed: true, generation: 1 });
    expect(replay.headers.get("set-cookie")).toBeNull();
    const cooledDown = await resetRequest(newAdminCookie, {
      idempotencyKey: "integration-reset-0002",
    });
    expect(cooledDown.status).toBe(429);
    expect(cooledDown.headers.get("retry-after")).toBeTruthy();

    const statusResponse = await resetStatus(
      new Request("http://northstar.test/api/northstar/admin/reset", {
        headers: { cookie: newAdminCookie },
      }),
    );
    expect(statusResponse.status).toBe(200);
    expect(await statusResponse.json()).toMatchObject({
      available: true,
      canonicalRecordCount: 2090,
      liveRecordCount: 2090,
      generation: 1,
      resetInProgress: false,
    });
  });
});

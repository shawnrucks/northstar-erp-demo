import { afterEach, describe, expect, it } from "vitest";

import { POST as login } from "@/app/api/northstar/login/route";
import { GET as exportPdf } from "@/app/api/northstar/reports/[number]/pdf/route";
import { POST as saveReport } from "@/app/api/northstar/reports/route";
import { nsdb } from "@/lib/northstar";

function postRequest(url: string, body: object, cookie?: string, idempotencyKey = crypto.randomUUID()) {
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

async function operationsSession() {
  const response = await login(
    postRequest("http://northstar.test/api/northstar/login", {
      email: "operations@northstar-demo.com",
      password: "Demo123!",
    }),
  );
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!.match(/ns_session=[^;]+/)![0];
}

describe("daily operations reports", () => {
  const number = "DOR-VITEST-001";
  const longNumber = "DOR-VITEST-LONG";

  afterEach(() => {
    nsdb.prepare("DELETE FROM reports WHERE number IN (?,?)").run(number, longNumber);
    nsdb.prepare("DELETE FROM audit_events WHERE record_number IN (?,?)").run(number, longNumber);
    nsdb.prepare("DELETE FROM northstar_sessions").run();
  });

  it("creates, finalizes, audits, and exports a live-metrics report", async () => {
    const cookie = await operationsSession();
    const idempotencyKey = "vitest-report-idempotency-0001";
    const reportBody = {
      number,
      executiveSummary: "Material supply remains the primary production risk.",
      managementDecisions: "Caleb to confirm the A36 recovery plan by noon.",
      finalize: true,
    };
    const response = await saveReport(
      postRequest(
        "http://northstar.test/api/northstar/reports",
        reportBody,
        cookie,
        idempotencyKey,
      ),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      number,
      status: "FINAL",
    });

    const report = nsdb.prepare("SELECT * FROM reports WHERE number=?").get(number) as {
      status: string;
      metrics: string;
      finalized_at: string | null;
    };
    expect(report.status).toBe("FINAL");
    expect(report.finalized_at).not.toBeNull();
    expect(JSON.parse(report.metrics)).toMatchObject({
      shortages: 20,
      pastDuePOs: 15,
      quality: 8,
      invoices: 9,
    });

    expect(
      nsdb
        .prepare("SELECT count(*) FROM audit_events WHERE record_number=?")
        .pluck()
        .get(number),
    ).toBe(1);

    const replay = await saveReport(
      postRequest(
        "http://northstar.test/api/northstar/reports",
        reportBody,
        cookie,
        idempotencyKey,
      ),
    );
    expect(replay.status).toBe(200);
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    expect(
      nsdb
        .prepare("SELECT count(*) FROM audit_events WHERE record_number=?")
        .pluck()
        .get(number),
    ).toBe(1);

    const pdf = await exportPdf(
      new Request("http://northstar.test", { headers: { cookie } }),
      { params: Promise.resolve({ number }) },
    );
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe(
      "%PDF-",
    );

    const attemptedRewrite = await saveReport(
      postRequest(
        "http://northstar.test/api/northstar/reports",
        {
          number,
          executiveSummary: "This must not replace a final report.",
          finalize: false,
        },
        cookie,
      ),
    );
    expect(attemptedRewrite.status).toBe(409);
    expect(
      nsdb
        .prepare("SELECT executive_summary FROM reports WHERE number=?")
        .pluck()
        .get(number),
    ).toBe("Material supply remains the primary production risk.");
  });

  it("paginates long report content instead of clipping it below the page", async () => {
    const cookie = await operationsSession();
    const response = await saveReport(
      postRequest(
        "http://northstar.test/api/northstar/reports",
        {
          number: longNumber,
          executiveSummary: "Material recovery and customer commitment review. ".repeat(170),
          managementDecisions: "Owners will report recovery status at the next shift review.",
          finalize: false,
        },
        cookie,
      ),
    );
    expect(response.status).toBe(200);

    const pdf = await exportPdf(
      new Request("http://northstar.test", { headers: { cookie } }),
      { params: Promise.resolve({ number: longNumber }) },
    );
    expect(pdf.status).toBe(200);
    const content = Buffer.from(await pdf.arrayBuffer()).toString("latin1");
    expect(content).toMatch(/\/Type \/Pages \/Kids \[[^\]]+\] \/Count ([2-9]|\d{2,})/);
  });
});

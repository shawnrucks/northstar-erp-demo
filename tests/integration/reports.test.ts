import { afterEach, describe, expect, it } from "vitest";

import { POST as login } from "@/app/api/northstar/login/route";
import { GET as exportPdf } from "@/app/api/northstar/reports/[number]/pdf/route";
import { POST as saveReport } from "@/app/api/northstar/reports/route";
import { nsdb } from "@/lib/northstar";

function postRequest(url: string, body: object, cookie?: string) {
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

  afterEach(() => {
    nsdb.prepare("DELETE FROM reports WHERE number=?").run(number);
    nsdb.prepare("DELETE FROM audit_events WHERE record_number=?").run(number);
    nsdb.prepare("DELETE FROM northstar_sessions").run();
  });

  it("creates, finalizes, audits, and exports a live-metrics report", async () => {
    const cookie = await operationsSession();
    const response = await saveReport(
      postRequest(
        "http://northstar.test/api/northstar/reports",
        {
          number,
          executiveSummary: "Material supply remains the primary production risk.",
          managementDecisions: "Caleb to confirm the A36 recovery plan by noon.",
          finalize: true,
        },
        cookie,
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

    const pdf = await exportPdf(
      new Request("http://northstar.test", { headers: { cookie } }),
      { params: Promise.resolve({ number }) },
    );
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe(
      "%PDF-",
    );
  });
});

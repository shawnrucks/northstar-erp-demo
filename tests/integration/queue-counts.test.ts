import { describe, expect, it } from "vitest";

import {
  northstarRepository,
  type NorthstarMetrics,
  type NorthstarRecordFilter,
} from "@/lib/northstar";

describe("dashboard and work-queue counts", () => {
  it("returns deterministic dashboard metrics from the seeded records", async () => {
    await expect(northstarRepository.getMetrics()).resolves.toEqual({
      newRfqs: 6,
      rfqMissingInformation: 5,
      quotes: 5,
      holds: 4,
      shortages: 20,
      pastDuePOs: 15,
      atRiskWOs: 9,
      productionExceptions: 10,
      quality: 8,
      shipments: 3,
      confirmations: 23,
      invoices: 9,
    });
  });

  const queues: Array<[
    keyof NorthstarMetrics,
    NorthstarRecordFilter,
  ]> = [
    ["newRfqs", { type: "RFQ", status: "NEW" }],
    ["rfqMissingInformation", { type: "RFQ", status: "MISSING_INFORMATION" }],
    ["quotes", { type: "QUOTE", status: "AWAITING_APPROVAL" }],
    ["holds", { type: "SALES_ORDER", status: "ON_HOLD" }],
    ["shortages", { type: "SHORTAGE", excludeStatuses: ["RESOLVED"] }],
    ["pastDuePOs", { type: "PURCHASE_ORDER", status: "PAST_DUE" }],
    ["atRiskWOs", { type: "WORK_ORDER", status: "MATERIAL_PENDING" }],
    ["productionExceptions", { type: "EXCEPTION", excludeStatuses: ["RESOLVED"] }],
    ["quality", { type: "QUALITY_HOLD", status: "QUALITY_HOLD" }],
    ["shipments", { type: "SALES_ORDER", dueToday: true }],
    ["confirmations", { type: "PURCHASE_ORDER", confirmation: "AWAITING_RESPONSE" }],
    [
      "invoices",
      {
        type: "INVOICE",
        statuses: [
          "PRICE_EXCEPTION",
          "QUANTITY_EXCEPTION",
          "MISSING_RECEIPT",
          "MISSING_PO",
          "ON_HOLD",
        ],
      },
    ],
  ];

  it.each(queues)("keeps %s in sync with its typed queue filter", async (name, filter) => {
    const [metrics, records] = await Promise.all([
      northstarRepository.getMetrics(),
      northstarRepository.listRecords({ ...filter, limit: 500 }),
    ]);
    expect(metrics[name]).toBe(records.length);
  });
});

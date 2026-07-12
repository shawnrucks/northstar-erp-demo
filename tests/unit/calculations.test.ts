import { describe, expect, it } from "vitest";
import { calculateQuote, invoicePriceVariance, quoteApprovalRequirement } from "@/lib/northstar-domain";

const seededQuote = {
  materialCost: 18_750,
  outsideProcessing: 6_500,
  laborHours: 220,
  laborRate: 42,
  machineHours: 180,
  machineRate: 65,
  setupCost: 2_400,
  toolingCost: 4_800,
  packagingCost: 1_750,
  freight: 1_200,
  scrapPct: 4,
  overhead: 7_900,
  revenue: 88_188,
};

describe("Northstar quote and invoice calculations", () => {
  it("calculates the seeded quote total and approximate margin", () => {
    const result = calculateQuote(seededQuote);
    expect(result.subtotal).toBe(56_340);
    expect(result.scrapCost).toBe(2_253.6);
    expect(result.totalCost).toBe(66_493.6);
    expect(result.grossMarginPct).toBeCloseTo(24.6, 1);
  });

  it("requires Sales Manager approval for the seeded quote", () => {
    const result = quoteApprovalRequirement(seededQuote);
    expect(result.blocked).toBe(false);
    expect(result.approvals).toEqual(["SALES_MANAGER"]);
  });

  it("blocks approval submission when the drawing revision is missing", () => {
    const result = quoteApprovalRequirement(seededQuote, { missingDrawingRevision: true });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("drawing revision");
  });

  it("identifies the seeded invoice variance as outside tolerance", () => {
    const result = invoicePriceVariance(1.18, 1.27, 2);
    expect(result.variancePct).toBe(7.63);
    expect(result.outsideTolerance).toBe(true);
  });
});

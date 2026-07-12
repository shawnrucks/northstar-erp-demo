export type QuoteInputs = {
  materialCost: number;
  outsideProcessing: number;
  laborHours: number;
  laborRate: number;
  machineHours: number;
  machineRate: number;
  setupCost: number;
  toolingCost: number;
  packagingCost: number;
  freight: number;
  scrapPct: number;
  overhead: number;
  revenue: number;
};

export type QuoteApproval = "NONE" | "SALES_MANAGER" | "EXECUTIVE" | "PRODUCTION_PLANNER";

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function calculateQuote(input: QuoteInputs) {
  const laborCost = money(input.laborHours * input.laborRate);
  const machineCost = money(input.machineHours * input.machineRate);
  const subtotal = money(
    input.materialCost +
    input.outsideProcessing +
    laborCost +
    machineCost +
    input.setupCost +
    input.toolingCost +
    input.packagingCost +
    input.freight,
  );
  const scrapCost = money(subtotal * (input.scrapPct / 100));
  const totalCost = money(subtotal + scrapCost + input.overhead);
  const grossMarginPct = input.revenue > 0
    ? money(((input.revenue - totalCost) / input.revenue) * 100)
    : 0;
  return { laborCost, machineCost, subtotal, scrapCost, totalCost, grossMarginPct };
}

export function quoteApprovalRequirement(input: QuoteInputs, options: { leadTimeBelowStandard?: boolean; missingDrawingRevision?: boolean } = {}) {
  const calculated = calculateQuote(input);
  const approvals = new Set<QuoteApproval>();
  if (calculated.grossMarginPct < 20 || input.toolingCost > 10_000) approvals.add("EXECUTIVE");
  else if (calculated.grossMarginPct < 30) approvals.add("SALES_MANAGER");
  if (options.leadTimeBelowStandard) approvals.add("PRODUCTION_PLANNER");
  return {
    blocked: Boolean(options.missingDrawingRevision),
    reason: options.missingDrawingRevision ? "A drawing revision is required before submission." : null,
    approvals: approvals.size ? Array.from(approvals) : ["NONE" as const],
    ...calculated,
  };
}

export function invoicePriceVariance(poUnitPrice: number, invoiceUnitPrice: number, tolerancePct: number) {
  const variancePct = poUnitPrice > 0 ? money(((invoiceUnitPrice - poUnitPrice) / poUnitPrice) * 100) : 0;
  return { variancePct, outsideTolerance: Math.abs(variancePct) > tolerancePct };
}

export const requiredRfqFields = [
  "customer",
  "itemDescription",
  "quantity",
  "requestedDelivery",
  "material",
  "drawingNumber",
  "drawingRevision",
  "assignedEstimator",
] as const;

export function missingRfqFields(data: Record<string, unknown>) {
  return requiredRfqFields.filter((field) => {
    const value = data[field];
    return value === undefined || value === null || value === "" || value === 0;
  });
}

const transitions: Record<string, Record<string, string[]>> = {
  RFQ: {
    MISSING_INFORMATION: ["COSTING", "CANCELLED"],
    COSTING: ["READY_FOR_QUOTE", "MISSING_INFORMATION", "CANCELLED"],
    READY_FOR_QUOTE: ["AWAITING_APPROVAL", "CANCELLED"],
    AWAITING_APPROVAL: ["SUBMITTED", "COSTING", "CANCELLED"],
  },
  QUOTE: {
    DRAFT: ["COSTING", "CANCELLED"],
    COSTING: ["AWAITING_APPROVAL", "CANCELLED"],
    AWAITING_APPROVAL: ["APPROVED", "COSTING", "CANCELLED"],
    APPROVED: ["SUBMITTED", "CANCELLED"],
    SUBMITTED: ["WON", "LOST", "EXPIRED"],
  },
  PURCHASE_ORDER: {
    AWAITING_CONFIRMATION: ["CONFIRMED", "ON_HOLD", "CANCELLED"],
    CONFIRMED: ["PARTIALLY_RECEIVED", "RECEIVED", "PAST_DUE", "ON_HOLD"],
    ON_HOLD: ["AWAITING_CONFIRMATION", "CONFIRMED", "CANCELLED"],
  },
  SHORTAGE: {
    OPEN: ["REVIEWING", "ESCALATED", "CANCELLED"],
    REVIEWING: ["TRANSFER_AVAILABLE", "PURCHASE_REQUIRED", "SUPPLIER_EXPEDITE", "ESCALATED", "RESOLVED"],
    ESCALATED: ["REVIEWING", "RESOLVED", "CANCELLED"],
  },
  EXCEPTION: {
    OPEN: ["ASSIGNED", "IN_REVIEW", "ESCALATED"],
    ASSIGNED: ["IN_REVIEW", "ACTION_REQUIRED", "ESCALATED", "RESOLVED"],
    IN_REVIEW: ["ACTION_REQUIRED", "WAITING_EXTERNAL", "ESCALATED", "RESOLVED"],
    ESCALATED: ["IN_REVIEW", "RESOLVED"],
    RESOLVED: ["CLOSED"],
  },
  INVOICE: {
    PRICE_EXCEPTION: ["ON_HOLD", "APPROVAL_REQUIRED", "MATCHED", "REJECTED"],
    QUANTITY_EXCEPTION: ["ON_HOLD", "APPROVAL_REQUIRED", "MATCHED", "REJECTED"],
    ON_HOLD: ["PRICE_EXCEPTION", "QUANTITY_EXCEPTION", "APPROVAL_REQUIRED", "MATCHED", "REJECTED"],
    APPROVAL_REQUIRED: ["APPROVED", "ON_HOLD", "REJECTED"],
  },
};

export function canTransition(type: string, from: string, to: string) {
  return Boolean(transitions[type]?.[from]?.includes(to));
}

export function assertTransition(type: string, from: string, to: string) {
  if (!canTransition(type, from, to)) {
    throw new Error(`${type.replaceAll("_", " ")} cannot move from ${from.replaceAll("_", " ")} to ${to.replaceAll("_", " ")}.`);
  }
}

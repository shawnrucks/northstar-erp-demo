import type { NorthstarRole, NorthstarUser } from "@/lib/northstar-auth";

export const NORTHSTAR_RECORD_ACTIONS = [
  "requestInfo",
  "updateRfq",
  "addCostLine",
  "createQuote",
  "submitApproval",
  "approve",
  "submitQuote",
  "supplierFollowup",
  "confirmPO",
  "task",
  "note",
  "transfer",
  "updateShortage",
  "escalate",
  "updateException",
  "includeInReport",
  "invoiceHold",
  "confirmVariance",
  "creditRequest",
] as const;

export type NorthstarRecordAction = (typeof NORTHSTAR_RECORD_ACTIONS)[number];
export type NorthstarReportAction = "saveDraft" | "finalize" | "export";

const MODULE_ROLES: Record<string, readonly NorthstarRole[]> = {
  dashboard: ["ADMIN", "SALES_COORDINATOR", "BUYER", "PRODUCTION_PLANNER", "OPERATIONS_ANALYST", "ACCOUNTS_PAYABLE", "QUALITY_SPECIALIST"],
  customers: ["ADMIN", "SALES_COORDINATOR", "OPERATIONS_ANALYST"],
  rfqs: ["ADMIN", "SALES_COORDINATOR", "OPERATIONS_ANALYST"],
  quotes: ["ADMIN", "SALES_COORDINATOR", "OPERATIONS_ANALYST"],
  "sales-orders": ["ADMIN", "SALES_COORDINATOR", "OPERATIONS_ANALYST"],
  "production-planning": ["ADMIN", "PRODUCTION_PLANNER", "OPERATIONS_ANALYST"],
  "work-orders": ["ADMIN", "PRODUCTION_PLANNER", "OPERATIONS_ANALYST", "QUALITY_SPECIALIST"],
  "material-shortages": ["ADMIN", "BUYER", "PRODUCTION_PLANNER", "OPERATIONS_ANALYST"],
  "production-exceptions": ["ADMIN", "PRODUCTION_PLANNER", "OPERATIONS_ANALYST"],
  "purchase-orders": ["ADMIN", "BUYER", "PRODUCTION_PLANNER", "OPERATIONS_ANALYST", "ACCOUNTS_PAYABLE"],
  suppliers: ["ADMIN", "BUYER", "OPERATIONS_ANALYST", "ACCOUNTS_PAYABLE", "QUALITY_SPECIALIST"],
  inventory: ["ADMIN", "BUYER", "PRODUCTION_PLANNER", "OPERATIONS_ANALYST", "QUALITY_SPECIALIST"],
  quality: ["ADMIN", "QUALITY_SPECIALIST", "OPERATIONS_ANALYST"],
  shipping: ["ADMIN", "SALES_COORDINATOR", "OPERATIONS_ANALYST"],
  invoices: ["ADMIN", "ACCOUNTS_PAYABLE", "BUYER", "OPERATIONS_ANALYST"],
  queues: ["ADMIN", "SALES_COORDINATOR", "BUYER", "PRODUCTION_PLANNER", "OPERATIONS_ANALYST", "ACCOUNTS_PAYABLE", "QUALITY_SPECIALIST"],
  reports: ["ADMIN", "SALES_COORDINATOR", "BUYER", "PRODUCTION_PLANNER", "OPERATIONS_ANALYST", "ACCOUNTS_PAYABLE", "QUALITY_SPECIALIST"],
  "audit-log": ["ADMIN", "SALES_COORDINATOR", "BUYER", "PRODUCTION_PLANNER", "OPERATIONS_ANALYST", "ACCOUNTS_PAYABLE", "QUALITY_SPECIALIST"],
  admin: ["ADMIN"],
};

export function canViewNorthstarModule(user: Pick<NorthstarUser, "role">, module: string) {
  return Boolean(MODULE_ROLES[module]?.includes(user.role));
}

const RECORD_MODULE: Record<string, string> = {
  CUSTOMER: "customers", RFQ: "rfqs", QUOTE: "quotes", SALES_ORDER: "sales-orders",
  WORK_ORDER: "work-orders", PURCHASE_ORDER: "purchase-orders", SUPPLIER: "suppliers",
  ITEM: "inventory", MATERIAL: "inventory", INVENTORY_BALANCE: "inventory",
  SHORTAGE: "material-shortages", EXCEPTION: "production-exceptions", QUALITY_HOLD: "quality",
  INVOICE: "invoices", RTV: "quality",
};

export function canViewNorthstarRecord(user: Pick<NorthstarUser, "role">, recordType: string) {
  const module = RECORD_MODULE[recordType];
  return Boolean(module && canViewNorthstarModule(user, module));
}

type RecordForAuthorization = {
  type: string;
  status: string;
};

type ActionRule = {
  recordType: string;
  roles: readonly NorthstarRole[];
  statuses: readonly string[] | "*";
};

const ADMIN = ["ADMIN"] as const satisfies readonly NorthstarRole[];
const SALES = ["ADMIN", "SALES_COORDINATOR"] as const satisfies readonly NorthstarRole[];
const PURCHASING = ["ADMIN", "BUYER"] as const satisfies readonly NorthstarRole[];
const PLANNING = ["ADMIN", "PRODUCTION_PLANNER"] as const satisfies readonly NorthstarRole[];
const PLANNING_AND_BUYING = [
  "ADMIN",
  "PRODUCTION_PLANNER",
  "BUYER",
] as const satisfies readonly NorthstarRole[];
const OPERATIONS = [
  "ADMIN",
  "OPERATIONS_ANALYST",
  "PRODUCTION_PLANNER",
] as const satisfies readonly NorthstarRole[];
const FINANCE = ["ADMIN", "ACCOUNTS_PAYABLE"] as const satisfies readonly NorthstarRole[];

const RFQ_INTAKE = ["NEW", "MISSING_INFORMATION", "ENGINEERING_REVIEW"] as const;
const RFQ_COSTING = ["COSTING"] as const;
const QUOTE_DRAFT = ["DRAFT", "COSTING"] as const;
const PO_OPEN = ["AWAITING_CONFIRMATION", "PAST_DUE"] as const;
const SHORTAGE_OPEN = ["OPEN", "ESCALATED"] as const;
const EXCEPTION_OPEN = ["OPEN", "ESCALATED"] as const;
const INVOICE_EXCEPTION = [
  "PRICE_EXCEPTION",
  "QUANTITY_EXCEPTION",
  "MISSING_RECEIPT",
  "MISSING_PO",
] as const;
const INVOICE_REVIEW = [...INVOICE_EXCEPTION, "ON_HOLD"] as const;

const ACTION_RULES: Record<NorthstarRecordAction, readonly ActionRule[]> = {
  requestInfo: [{ recordType: "RFQ", roles: SALES, statuses: RFQ_INTAKE }],
  updateRfq: [{ recordType: "RFQ", roles: SALES, statuses: RFQ_INTAKE }],
  addCostLine: [{ recordType: "RFQ", roles: SALES, statuses: RFQ_COSTING }],
  createQuote: [{ recordType: "RFQ", roles: SALES, statuses: RFQ_COSTING }],
  submitApproval: [{ recordType: "QUOTE", roles: SALES, statuses: QUOTE_DRAFT }],
  approve: [{ recordType: "QUOTE", roles: ADMIN, statuses: ["AWAITING_APPROVAL"] }],
  submitQuote: [{ recordType: "QUOTE", roles: SALES, statuses: ["APPROVED"] }],
  supplierFollowup: [{ recordType: "PURCHASE_ORDER", roles: PURCHASING, statuses: PO_OPEN }],
  confirmPO: [{ recordType: "PURCHASE_ORDER", roles: PURCHASING, statuses: PO_OPEN }],
  task: [
    {
      recordType: "PURCHASE_ORDER",
      roles: PURCHASING,
      statuses: [...PO_OPEN, "CONFIRMED"],
    },
    { recordType: "SHORTAGE", roles: PLANNING_AND_BUYING, statuses: SHORTAGE_OPEN },
    { recordType: "EXCEPTION", roles: OPERATIONS, statuses: EXCEPTION_OPEN },
    { recordType: "INVOICE", roles: FINANCE, statuses: INVOICE_REVIEW },
  ],
  note: [
    { recordType: "RFQ", roles: SALES, statuses: "*" },
    { recordType: "QUOTE", roles: SALES, statuses: "*" },
    { recordType: "PURCHASE_ORDER", roles: PURCHASING, statuses: "*" },
    { recordType: "SHORTAGE", roles: PLANNING_AND_BUYING, statuses: "*" },
    { recordType: "EXCEPTION", roles: OPERATIONS, statuses: "*" },
    { recordType: "INVOICE", roles: FINANCE, statuses: "*" },
  ],
  transfer: [{ recordType: "SHORTAGE", roles: PLANNING, statuses: SHORTAGE_OPEN }],
  updateShortage: [{ recordType: "SHORTAGE", roles: PLANNING, statuses: SHORTAGE_OPEN }],
  escalate: [{ recordType: "SHORTAGE", roles: PLANNING, statuses: ["OPEN"] }],
  updateException: [{ recordType: "EXCEPTION", roles: OPERATIONS, statuses: EXCEPTION_OPEN }],
  includeInReport: [
    {
      recordType: "EXCEPTION",
      roles: ["ADMIN", "OPERATIONS_ANALYST"],
      statuses: "*",
    },
  ],
  invoiceHold: [{ recordType: "INVOICE", roles: FINANCE, statuses: INVOICE_EXCEPTION }],
  confirmVariance: [{ recordType: "INVOICE", roles: FINANCE, statuses: INVOICE_REVIEW }],
  creditRequest: [{ recordType: "INVOICE", roles: FINANCE, statuses: INVOICE_REVIEW }],
};

const REPORT_RULES: Record<NorthstarReportAction, readonly NorthstarRole[]> = {
  saveDraft: ["ADMIN", "OPERATIONS_ANALYST"],
  finalize: ["ADMIN", "OPERATIONS_ANALYST"],
  export: ["ADMIN", "OPERATIONS_ANALYST"],
};

export type AuthorizationResult =
  | { allowed: true; action: NorthstarRecordAction }
  | {
      allowed: false;
      status: 400 | 403 | 409;
      code: "UNKNOWN_ACTION" | "ROLE_FORBIDDEN" | "RECORD_TYPE_FORBIDDEN" | "INVALID_STATE";
      message: string;
    };

export function isNorthstarRecordAction(value: unknown): value is NorthstarRecordAction {
  return (
    typeof value === "string" &&
    (NORTHSTAR_RECORD_ACTIONS as readonly string[]).includes(value)
  );
}

export function authorizeNorthstarRecordAction(
  user: Pick<NorthstarUser, "role">,
  actionValue: unknown,
  record: RecordForAuthorization,
): AuthorizationResult {
  if (!isNorthstarRecordAction(actionValue)) {
    return {
      allowed: false,
      status: 400,
      code: "UNKNOWN_ACTION",
      message: "Unknown action.",
    };
  }

  const matchingType = ACTION_RULES[actionValue].filter((rule) => rule.recordType === record.type);
  if (matchingType.length === 0) {
    return {
      allowed: false,
      status: 403,
      code: "RECORD_TYPE_FORBIDDEN",
      message: "This action is not available for this record type.",
    };
  }

  const matchingRole = matchingType.filter((rule) => rule.roles.includes(user.role));
  if (matchingRole.length === 0) {
    return {
      allowed: false,
      status: 403,
      code: "ROLE_FORBIDDEN",
      message: "Your role is not authorized for this action.",
    };
  }

  if (
    !matchingRole.some(
      (rule) => rule.statuses === "*" || rule.statuses.includes(record.status),
    )
  ) {
    return {
      allowed: false,
      status: 409,
      code: "INVALID_STATE",
      message: `This action is not available while the record is ${record.status}.`,
    };
  }

  return { allowed: true, action: actionValue };
}

export function authorizeNorthstarReportAction(
  user: Pick<NorthstarUser, "role">,
  action: NorthstarReportAction,
) {
  return REPORT_RULES[action].includes(user.role);
}

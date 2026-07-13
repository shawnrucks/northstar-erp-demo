import { NextResponse } from "next/server";
import {
  northstarRepository,
  northstarSql,
  type NorthstarQueryExecutor,
  type NorthstarRecord,
  type NorthstarRecordData,
} from "@/lib/northstar";
import {
  authenticateNorthstarRequest,
  isJsonRequest,
  isSameOriginRequest,
  type NorthstarUser,
} from "@/lib/northstar-auth";
import {
  authorizeNorthstarRecordAction,
  type NorthstarRecordAction,
} from "@/lib/northstar-permissions";
import { invoicePriceVariance, missingRfqFields, quoteApprovalRequirement } from "@/lib/northstar-domain";
import { executeNorthstarMutation } from "@/lib/northstar-mutation-guard";

class InvalidActionInput extends Error {}

class ActionHttpError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409,
    readonly code?: string,
  ) {
    super(message);
  }
}

function text(
  body: Record<string, unknown>,
  key: string,
  options: { required?: boolean; max?: number; fallback?: string } = {},
) {
  const value = body[key];
  if (value == null || value === "") {
    if (options.required) throw new InvalidActionInput(`${key} is required.`);
    return options.fallback ?? "";
  }
  if (typeof value !== "string") throw new InvalidActionInput(`${key} must be text.`);
  const trimmed = value.trim();
  if (options.required && !trimmed) throw new InvalidActionInput(`${key} is required.`);
  if (trimmed.length > (options.max ?? 2_000)) {
    throw new InvalidActionInput(`${key} is too long.`);
  }
  return trimmed;
}

function isoDate(body: Record<string, unknown>, key: string, required = false) {
  const value = text(body, key, { required, max: 10 });
  if (!value) return "";
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new InvalidActionInput(`${key} must be a valid date.`);
  }
  return value;
}

function positiveNumber(body: Record<string, unknown>, key: string) {
  const value = typeof body[key] === "string" ? Number(body[key]) : body[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new InvalidActionInput(`${key} must be a positive number.`);
  }
  return value;
}

function oneOf<T extends string>(
  body: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T,
) {
  const value = text(body, key, { fallback });
  if (!allowed.includes(value as T)) {
    throw new InvalidActionInput(`${key} is not an allowed value.`);
  }
  return value as T;
}

function parseData(value: unknown): NorthstarRecordData {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as NorthstarRecordData;
  }
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as NorthstarRecordData)
      : {};
  } catch {
    return {};
  }
}

function normalizeRecord(row: Record<string, unknown>): NorthstarRecord {
  return {
    id: Number(row.id),
    type: String(row.type),
    number: String(row.number),
    title: String(row.title),
    party: String(row.party || ""),
    status: String(row.status),
    priority: String(row.priority || "NORMAL"),
    owner: String(row.owner || ""),
    due_date: row.due_date == null ? null : String(row.due_date),
    data: parseData(row.data),
    updated_at: String(row.updated_at || ""),
  };
}

async function findRecord(
  database: NorthstarQueryExecutor,
  number: string,
  lock = false,
) {
  const row = await database.get<Record<string, unknown>>(
    northstarSql({
      postgres: `SELECT id, type, number, title, party, status, priority, owner,
                        due_date, data, updated_at
                   FROM records WHERE number = $1${lock ? " FOR UPDATE" : ""}`,
      sqlite: `SELECT id, type, number, title, party, status, priority, owner,
                      due_date, data, updated_at
                 FROM records WHERE number = ?`,
    }),
    [number],
  );
  return row ? normalizeRecord(row) : null;
}

const updateStatusSql = northstarSql({
  postgres: `UPDATE records
                SET status = $1, version = version + 1, updated_at = CURRENT_TIMESTAMP
              WHERE number = $2`,
  sqlite: `UPDATE records SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE number = ?`,
});

const updateDataSql = northstarSql({
  postgres: `UPDATE records
                SET data = $1::jsonb, version = version + 1, updated_at = CURRENT_TIMESTAMP
              WHERE number = $2`,
  sqlite: `UPDATE records SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE number = ?`,
});

const updateStatusAndDataSql = northstarSql({
  postgres: `UPDATE records
                SET status = $1, data = $2::jsonb, version = version + 1,
                    updated_at = CURRENT_TIMESTAMP
              WHERE number = $3`,
  sqlite: `UPDATE records
              SET status = ?, data = ?, updated_at = CURRENT_TIMESTAMP
            WHERE number = ?`,
});

function auditValue(value: unknown) {
  if (value == null) return null;
  return typeof value === "string"
    ? value
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
}

async function appendAudit(
  database: NorthstarQueryExecutor,
  current: NorthstarRecord,
  user: NorthstarUser,
  action: string,
  field: string,
  oldValue: unknown,
  newValue: unknown,
  note: string,
) {
  await database.run(
    northstarSql({
      postgres: `INSERT INTO audit_events
        (user_name, user_role, module, record_type, record_number, action,
         field_changed, previous_value, new_value, note, session_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      sqlite: `INSERT INTO audit_events
        (user, user_role, module, record_type, record_number, action,
         field_changed, previous_value, new_value, note, session_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    }),
    [
      user.name,
      user.role,
      current.type,
      current.type,
      current.number,
      action,
      field || null,
      auditValue(oldValue),
      auditValue(newValue),
      note || null,
      user.session || "demo-session",
    ],
  );
}

async function performAction(
  database: NorthstarQueryExecutor,
  current: NorthstarRecord,
  user: NorthstarUser,
  action: NorthstarRecordAction,
  input: Record<string, unknown>,
) {
  const data = { ...current.data };
  let field = "status";
  let oldValue: unknown = current.status;
  let newValue: unknown = current.status;
  let note = text(input, "note", { max: 2_000 });

  switch (action) {
    case "requestInfo": {
      const recipient = text(input, "recipient", {
        max: 254,
        fallback: "laura.bennett@apexmotion.example",
      });
      const message = text(input, "message", {
        max: 5_000,
        fallback: "Please provide the missing drawing revision and packaging requirements.",
      });
      await database.run(
        northstarSql({
          postgres: `INSERT INTO communications
            (record_number, recipient, sender, subject, body, template, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          sqlite: `INSERT INTO communications
            (record_number, recipient, sender, subject, body, template, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
        }),
        [
          current.number,
          recipient,
          user.email,
          `Information required for ${current.number}`,
          message,
          "Customer information request",
          user.name,
        ],
      );
      if (current.status !== "MISSING_INFORMATION") {
        await database.run(updateStatusSql, ["MISSING_INFORMATION", current.number]);
      }
      field = "communication";
      oldValue = "";
      newValue = "SENT";
      note = "Customer information request sent";
      break;
    }
    case "updateRfq": {
      data.customer = text(input, "customer", { required: true, max: 200 });
      data.item = text(input, "item", { required: true, max: 100 });
      data.itemDescription = text(input, "itemDescription", { required: true, max: 300 });
      data.quantity = positiveNumber(input, "quantity");
      data.requestedDelivery = isoDate(input, "requestedDelivery", true);
      data.quoteDueDate = isoDate(input, "quoteDueDate", true);
      data.material = text(input, "material", { required: true, max: 300 });
      data.drawingNumber = text(input, "drawingNumber", { required: true, max: 100 });
      data.assignedEstimator = text(input, "assignedEstimator", { required: true, max: 200 });
      data.drawingRevision = text(input, "drawingRevision", { required: true, max: 50 });
      data.packaging = text(input, "packaging", { required: true, max: 500 });
      const missing = missingRfqFields(data);
      if (missing.length > 0) {
        throw new InvalidActionInput(`RFQ is missing required fields: ${missing.join(", ")}.`);
      }
      data.missing = [];
      newValue = "COSTING";
      await database.run(
        northstarSql({
          postgres: `UPDATE records
                        SET status=$1, data=$2::jsonb, party=$3, title=$4, owner=$5,
                            due_date=$6, version=version+1, updated_at=CURRENT_TIMESTAMP
                      WHERE number=$7`,
          sqlite: `UPDATE records
                      SET status=?, data=?, party=?, title=?, owner=?, due_date=?,
                          updated_at=CURRENT_TIMESTAMP
                    WHERE number=?`,
        }),
        [
          newValue,
          JSON.stringify(data),
          data.customer,
          data.itemDescription,
          data.assignedEstimator,
          data.quoteDueDate,
          current.number,
        ],
      );
      break;
    }
    case "approve": {
      const requirements = Array.isArray(data.approvalRequirements)
        ? data.approvalRequirements.map(String)
        : String(data.approval || "").split(",").filter(Boolean);
      const completed = new Set(
        Array.isArray(data.approvalsCompleted) ? data.approvalsCompleted.map(String) : [],
      );
      const commercialRequirements = requirements.filter(
        (requirement) => requirement !== "PRODUCTION_PLANNER" && requirement !== "NONE",
      );
      if (
        commercialRequirements.length === 0 ||
        commercialRequirements.every((requirement) => completed.has(requirement))
      ) {
        throw new ActionHttpError("Commercial approval is already complete.", 409, "ALREADY_APPROVED");
      }
      for (const requirement of requirements) {
        if (requirement !== "PRODUCTION_PLANNER" && requirement !== "NONE") {
          completed.add(requirement);
        }
      }
      data.approvalsCompleted = Array.from(completed);
      const remaining = requirements.filter(
        (requirement) => requirement !== "NONE" && !completed.has(requirement),
      );
      newValue = remaining.length === 0 ? "APPROVED" : "AWAITING_APPROVAL";
      await database.run(updateStatusAndDataSql, [
        newValue,
        JSON.stringify(data),
        current.number,
      ]);
      field = "approval";
      oldValue = requirements.join(",") || "PENDING";
      newValue = remaining.length ? remaining.join(",") : "APPROVED";
      break;
    }
    case "plannerApprove": {
      const requirements = Array.isArray(data.approvalRequirements)
        ? data.approvalRequirements.map(String)
        : String(data.approval || "").split(",").filter(Boolean);
      if (!requirements.includes("PRODUCTION_PLANNER")) {
        throw new InvalidActionInput("Production-planner approval is not required for this quote.");
      }
      const completed = new Set(
        Array.isArray(data.approvalsCompleted) ? data.approvalsCompleted.map(String) : [],
      );
      if (completed.has("PRODUCTION_PLANNER")) {
        throw new ActionHttpError("Production-planner approval is already complete.", 409, "ALREADY_APPROVED");
      }
      completed.add("PRODUCTION_PLANNER");
      data.approvalsCompleted = Array.from(completed);
      const remaining = requirements.filter(
        (requirement) => requirement !== "NONE" && !completed.has(requirement),
      );
      const nextStatus = remaining.length === 0 ? "APPROVED" : "AWAITING_APPROVAL";
      await database.run(updateStatusAndDataSql, [
        nextStatus,
        JSON.stringify(data),
        current.number,
      ]);
      field = "approval";
      oldValue = "PRODUCTION_PLANNER_PENDING";
      newValue = "PRODUCTION_PLANNER_APPROVED";
      break;
    }
    case "submitQuote": {
      newValue = "SUBMITTED";
      await database.run(updateStatusSql, [newValue, current.number]);
      await database.run(
        northstarSql({
          postgres: `INSERT INTO communications
            (record_number, recipient, sender, subject, body, template, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          sqlite: `INSERT INTO communications
            (record_number, recipient, sender, subject, body, template, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
        }),
        [
          current.number,
          "laura.bennett@apexmotion.example",
          user.email,
          `Northstar quotation ${current.number}`,
          "Please find Northstar's quotation for your review.",
          "Quote submission",
          user.name,
        ],
      );
      break;
    }
    case "supplierFollowup": {
      data.lastFollowup = new Date().toISOString().slice(0, 10);
      data.nextFollowup = isoDate(input, "nextFollowup");
      const recipient = text(input, "recipient", {
        max: 254,
        fallback: typeof data.contact === "string" ? data.contact : "",
      });
      if (!recipient) throw new InvalidActionInput("recipient is required.");
      const message = text(input, "message", {
        max: 5_000,
        fallback: "Please confirm pricing and delivery date.",
      });
      await database.run(updateDataSql, [JSON.stringify(data), current.number]);
      await database.run(
        northstarSql({
          postgres: `INSERT INTO communications
            (record_number, recipient, sender, subject, body, template, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          sqlite: `INSERT INTO communications
            (record_number, recipient, sender, subject, body, template, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
        }),
        [
          current.number,
          recipient,
          user.email,
          `Confirmation requested: ${current.number}`,
          message,
          "Supplier confirmation follow-up",
          user.name,
        ],
      );
      field = "communication";
      oldValue = "";
      newValue = "SENT";
      break;
    }
    case "confirmPO": {
      data.promisedDate = isoDate(input, "promisedDate", true);
      data.confirmation = "REVISED_DATE";
      newValue = "CONFIRMED";
      await database.run(updateStatusAndDataSql, [
        newValue,
        JSON.stringify(data),
        current.number,
      ]);
      break;
    }
    case "task": {
      const taskNumber = `TASK-${Date.now().toString().slice(-6)}`;
      const title = text(input, "title", { max: 200, fallback: "Supplier expedite" });
      const assignee = text(input, "assignee", { max: 200, fallback: current.owner });
      const priority = oneOf(input, "priority", ["NORMAL", "HIGH", "URGENT"] as const, "HIGH");
      const dueDate = isoDate(input, "dueDate");
      await database.run(
        northstarSql({
          postgres: `INSERT INTO tasks
            (number, title, record_number, assigned_user, created_by, priority, due_date, note)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          sqlite: `INSERT INTO tasks
            (number, title, record_number, assigned_user, created_by, priority, due_date, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        }),
        [
          taskNumber,
          title,
          current.number,
          assignee,
          user.name,
          priority,
          dueDate || null,
          note,
        ],
      );
      field = "task";
      oldValue = "";
      newValue = taskNumber;
      break;
    }
    case "transfer": {
      const from = text(input, "from", { required: true, max: 200 });
      const to = text(input, "to", {
        required: true,
        max: 200,
        fallback: "Denver Manufacturing",
      });
      const quantity = positiveNumber(input, "quantity");
      const availableByLocation: Record<string, number> = {
        "Denver Manufacturing": Number(data.denver || 0),
        "Fort Collins Fabrication": Number(data.fortCollins || 0),
        "Aurora Distribution": Number(data.aurora || 0),
      };
      if (!(from in availableByLocation)) {
        throw new InvalidActionInput("from is not an approved inventory location.");
      }
      if (!(to in availableByLocation) || to === from) {
        throw new InvalidActionInput("to must be a different approved inventory location.");
      }
      const inventoryFieldByLocation: Record<string, "denver" | "fortCollins" | "aurora"> = {
        "Denver Manufacturing": "denver",
        "Fort Collins Fabrication": "fortCollins",
        "Aurora Distribution": "aurora",
      };
      const sourceField = inventoryFieldByLocation[from];
      const itemKey = String(data.item || current.title);
      if (database.provider === "postgres") {
        await database.run("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `northstar_inventory_${itemKey}_${from}`,
        ]);
      }
      const shortageRows = await database.all<Record<string, unknown>>(
        "SELECT data FROM records WHERE type = 'SHORTAGE'",
      );
      let reservedAcrossShortages = 0;
      for (const row of shortageRows) {
        const shortageData = parseData(row.data);
        if (String(shortageData.item || "") !== itemKey || !Array.isArray(shortageData.transfers)) {
          continue;
        }
        for (const transfer of shortageData.transfers) {
          if (
            transfer &&
            typeof transfer === "object" &&
            (transfer as Record<string, unknown>).from === from &&
            (transfer as Record<string, unknown>).status === "SUBMITTED"
          ) {
            reservedAcrossShortages += Number((transfer as Record<string, unknown>).quantity || 0);
          }
        }
      }
      const currentReservations = (Array.isArray(data.transfers) ? data.transfers : [])
        .filter((transfer) => transfer && typeof transfer === "object")
        .map((transfer) => transfer as Record<string, unknown>)
        .filter((transfer) => transfer.from === from && transfer.status === "SUBMITTED")
        .reduce((total, transfer) => total + Number(transfer.quantity || 0), 0);
      const baseAvailability = availableByLocation[from] + currentReservations;
      const remainingAvailability = Math.max(0, baseAvailability - reservedAcrossShortages);
      if (quantity > remainingAvailability) {
        throw new InvalidActionInput(`Only ${remainingAvailability} LB is available at ${from}.`);
      }
      data[sourceField] = remainingAvailability - quantity;
      data.transferReserved = Number(data.transferReserved || 0) + quantity;
      const transferNumber = `TR-${Date.now().toString().slice(-6)}`;
      data.transfers = [
        ...(Array.isArray(data.transfers) ? data.transfers : []),
        { number: transferNumber, from, to, item: itemKey, quantity, status: "SUBMITTED" },
      ];
      await database.run(updateDataSql, [JSON.stringify(data), current.number]);
      field = "transfer";
      oldValue = "";
      newValue = `${transferNumber}: ${quantity} LB from ${from} to ${to}`;
      break;
    }
    case "escalate": {
      newValue = "ESCALATED";
      await database.run(updateStatusSql, [newValue, current.number]);
      break;
    }
    case "updateException": {
      data.customerImpact = text(input, "customerImpact", { max: 2_000 });
      data.productionImpact = text(input, "productionImpact", { max: 2_000 });
      data.estimatedCompletion = isoDate(input, "estimatedCompletion");
      const status = oneOf(
        input,
        "status",
        ["OPEN", "ESCALATED", "RESOLVED"] as const,
        current.status as "OPEN" | "ESCALATED",
      );
      const owner = text(input, "owner", { max: 200, fallback: current.owner });
      const priority = oneOf(
        input,
        "priority",
        ["NORMAL", "HIGH", "URGENT"] as const,
        current.priority as "NORMAL" | "HIGH" | "URGENT",
      );
      newValue = status;
      await database.run(
        northstarSql({
          postgres: `UPDATE records
                        SET status = $1, owner = $2, priority = $3, data = $4::jsonb,
                            version = version + 1, updated_at = CURRENT_TIMESTAMP
                      WHERE number = $5`,
          sqlite: `UPDATE records
                      SET status = ?, owner = ?, priority = ?, data = ?,
                          updated_at = CURRENT_TIMESTAMP
                    WHERE number = ?`,
        }),
        [status, owner, priority, JSON.stringify(data), current.number],
      );
      break;
    }
    case "invoiceHold": {
      data.hold = true;
      newValue = "ON_HOLD";
      await database.run(updateStatusAndDataSql, [
        newValue,
        JSON.stringify(data),
        current.number,
      ]);
      break;
    }
    case "creditRequest": {
      const message = text(input, "message", {
        max: 5_000,
        fallback: "Please issue a credit for the unit price variance.",
      });
      await database.run(
        northstarSql({
          postgres: `INSERT INTO communications
            (record_number, recipient, sender, subject, body, template, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          sqlite: `INSERT INTO communications
            (record_number, recipient, sender, subject, body, template, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
        }),
        [
          current.number,
          "credits@summitsteel.example",
          user.email,
          `Credit request for ${current.number}`,
          message,
          "Supplier credit request",
          user.name,
        ],
      );
      field = "communication";
      oldValue = "";
      newValue = "CREDIT_REQUEST_SENT";
      break;
    }
    case "note": {
      note = text(input, "note", { required: true, max: 2_000 });
      await database.run(
        northstarSql({
          postgres: `INSERT INTO notes(record_number, body, created_by) VALUES($1, $2, $3)`,
          sqlite: `INSERT INTO notes(record_number, body, created_by) VALUES(?, ?, ?)`,
        }),
        [current.number, note, user.name],
      );
      field = "note";
      oldValue = "";
      newValue = note;
      break;
    }
    case "addCostLine": {
      const category = oneOf(
        input,
        "category",
        [
          "MATERIAL",
          "OUTSIDE_PROCESSING",
          "LABOR",
          "MACHINE",
          "SETUP",
          "TOOLING",
          "PACKAGING",
          "FREIGHT",
          "OVERHEAD",
        ] as const,
        "MATERIAL",
      );
      const description = text(input, "description", { required: true, max: 300 });
      const amount = positiveNumber(input, "amount");
      const lines = Array.isArray(data.costLines) ? data.costLines : [];
      const line = {
        id: `COST-${Date.now().toString(36).toUpperCase()}`,
        category,
        description,
        amount,
      };
      data.costLines = [...lines, line];
      await database.run(updateDataSql, [JSON.stringify(data), current.number]);
      field = "costLine";
      oldValue = "";
      newValue = `${category}: ${description} ($${amount.toFixed(2)})`;
      break;
    }
    case "createQuote": {
      const quoteNumber = text(input, "quoteNumber", { required: true, max: 50 }).toUpperCase();
      if (!/^QT-\d{4}-\d{4,}$/.test(quoteNumber)) {
        throw new InvalidActionInput("quoteNumber must use the format QT-YYYY-NNNN.");
      }
      const revenue = positiveNumber(input, "revenue");
      const leadTimeDays = positiveNumber(input, "leadTimeDays");
      if (database.provider === "postgres") {
        await database.run("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `northstar_quote_${quoteNumber}`,
        ]);
      }
      const existing = await findRecord(database, quoteNumber, true);
      if (existing && existing.type !== "QUOTE") {
        throw new InvalidActionInput("That record number is already in use.");
      }
      if (existing && existing.data.rfq !== current.number) {
        throw new InvalidActionInput("That quote number belongs to another RFQ.");
      }
      if (existing && !["DRAFT", "COSTING", "AWAITING_APPROVAL"].includes(existing.status)) {
        throw new InvalidActionInput(`Quote ${quoteNumber} can no longer be revised.`);
      }
      const itemRecord = typeof data.item === "string"
        ? await findRecord(database, data.item, false)
        : null;
      const standardLeadTimeDays = Number(
        itemRecord?.data.standardLeadTimeDays || data.standardLeadTimeDays || 30,
      );
      const costLines = Array.isArray(data.costLines)
        ? (data.costLines as Array<{ category?: string; amount?: number }>)
        : [];
      const sum = (category: string) =>
        costLines
          .filter((lineItem) => lineItem.category === category)
          .reduce((total, lineItem) => total + Number(lineItem.amount || 0), 0);
      const quoteData = {
        ...(existing?.data || {}),
        rfq: current.number,
        quantity: Number(data.quantity || 0),
        materialCost: sum("MATERIAL") || Number(existing?.data.materialCost || 0),
        outsideProcessing:
          sum("OUTSIDE_PROCESSING") || Number(existing?.data.outsideProcessing || 0),
        laborHours: Number(existing?.data.laborHours || 0),
        laborRate: Number(existing?.data.laborRate || 0),
        machineHours: Number(existing?.data.machineHours || 0),
        machineRate: Number(existing?.data.machineRate || 0),
        setupCost: sum("SETUP") || Number(existing?.data.setupCost || 0),
        toolingCost: sum("TOOLING") || Number(existing?.data.toolingCost || 0),
        packagingCost: sum("PACKAGING") || Number(existing?.data.packagingCost || 0),
        freight: sum("FREIGHT") || Number(existing?.data.freight || 0),
        scrapPct: Number(existing?.data.scrapPct || 0),
        overhead: sum("OVERHEAD") || Number(existing?.data.overhead || 0),
        revenue,
        leadTimeDays,
        standardLeadTimeDays,
        approval: "PENDING_CALCULATION",
        approvalRequirements: [],
        approvalsCompleted: [],
      };
      if (existing) {
        await database.run(
          northstarSql({
            postgres: `UPDATE records
                          SET title = $1, party = $2, status = 'DRAFT', data = $3::jsonb,
                              version = version + 1, updated_at = CURRENT_TIMESTAMP
                        WHERE number = $4`,
            sqlite: `UPDATE records
                        SET title = ?, party = ?, status = 'DRAFT', data = ?,
                            updated_at = CURRENT_TIMESTAMP
                      WHERE number = ?`,
          }),
          [
            `${current.title} quotation`,
            current.party,
            JSON.stringify(quoteData),
            quoteNumber,
          ],
        );
      } else {
        await database.run(
          northstarSql({
            postgres: `INSERT INTO records
              (type, number, title, party, status, priority, owner, due_date, data)
              VALUES('QUOTE', $1, $2, $3, 'DRAFT', $4, $5, $6, $7::jsonb)`,
            sqlite: `INSERT INTO records
              (type, number, title, party, status, priority, owner, due_date, data)
              VALUES('QUOTE', ?, ?, ?, 'DRAFT', ?, ?, ?, ?)`,
          }),
          [
            quoteNumber,
            `${current.title} quotation`,
            current.party,
            current.priority,
            current.owner,
            current.due_date,
            JSON.stringify(quoteData),
          ],
        );
      }
      data.quote = quoteNumber;
      await database.run(updateDataSql, [JSON.stringify(data), current.number]);
      field = "quote";
      oldValue = "";
      newValue = quoteNumber;
      break;
    }
    case "submitApproval": {
      const linkedRfq =
        typeof data.rfq === "string" ? await findRecord(database, data.rfq, false) : null;
      if (!linkedRfq?.data.drawingRevision) {
        throw new InvalidActionInput(
          "A drawing revision is required before approval can be requested.",
        );
      }
      const result = quoteApprovalRequirement({
        materialCost: Number(data.materialCost || 0),
        outsideProcessing: Number(data.outsideProcessing || 0),
        laborHours: Number(data.laborHours || 0),
        laborRate: Number(data.laborRate || 0),
        machineHours: Number(data.machineHours || 0),
        machineRate: Number(data.machineRate || 0),
        setupCost: Number(data.setupCost || 0),
        toolingCost: Number(data.toolingCost || 0),
        packagingCost: Number(data.packagingCost || 0),
        freight: Number(data.freight || 0),
        scrapPct: Number(data.scrapPct || 0),
        overhead: Number(data.overhead || 0),
        revenue: Number(data.revenue || 0),
      }, {
        leadTimeBelowStandard:
          Number(data.leadTimeDays || 0) > 0 &&
          Number(data.standardLeadTimeDays || 0) > 0 &&
          Number(data.leadTimeDays) < Number(data.standardLeadTimeDays),
        missingDrawingRevision: !linkedRfq.data.drawingRevision,
      });
      data.approval = result.approvals.join(",");
      data.approvalRequirements = result.approvals.filter((approval) => approval !== "NONE");
      data.approvalsCompleted = [];
      data.calculatedMargin = result.grossMarginPct;
      data.totalEstimatedCost = result.totalCost;
      newValue = result.approvals.every((approval) => approval === "NONE")
        ? "APPROVED"
        : "AWAITING_APPROVAL";
      await database.run(updateStatusAndDataSql, [
        newValue,
        JSON.stringify(data),
        current.number,
      ]);
      break;
    }
    case "updateShortage": {
      const value =
        typeof input.remainingShortage === "string"
          ? Number(input.remainingShortage)
          : input.remainingShortage;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new InvalidActionInput("remainingShortage must be zero or a positive number.");
      }
      data.shortage = value;
      data.resolution = text(input, "resolution", { max: 2_000 });
      await database.run(updateDataSql, [JSON.stringify(data), current.number]);
      field = "shortageQuantity";
      oldValue = current.data.shortage;
      newValue = value;
      note = String(data.resolution || "");
      break;
    }
    case "includeInReport": {
      data.includeInNextReport = true;
      await database.run(updateDataSql, [JSON.stringify(data), current.number]);
      field = "dailyOperationsReport";
      oldValue = "NOT_INCLUDED";
      newValue = "INCLUDE_IN_NEXT_REPORT";
      break;
    }
    case "confirmVariance": {
      const variance = invoicePriceVariance(
        Number(data.poUnitPrice || 0),
        Number(data.invoiceUnitPrice || 0),
        Number(data.tolerance || 0),
      );
      data.varianceConfirmed = true;
      data.variancePct = variance.variancePct;
      data.outsideTolerance = variance.outsideTolerance;
      note = text(input, "note", {
        max: 2_000,
        fallback: "Unit-price variance reviewed against configured tolerance.",
      });
      await database.run(updateDataSql, [JSON.stringify(data), current.number]);
      field = "varianceReview";
      oldValue = "UNCONFIRMED";
      newValue = variance.outsideTolerance ? "OUTSIDE_TOLERANCE" : "WITHIN_TOLERANCE";
      break;
    }
  }

  await appendAudit(database, current, user, action, field, oldValue, newValue, note);
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  }
  if (!isJsonRequest(request)) {
    return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 });
  }

  const user = await authenticateNorthstarRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  return executeNorthstarMutation(request, user, "record-action", async () => {

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const number = typeof input.number === "string" ? input.number.trim() : "";
  if (!number || number.length > 100) {
    return NextResponse.json({ error: "A valid record number is required." }, { status: 400 });
  }

  try {
    await northstarRepository.transaction(async (database) => {
      if (database.provider === "postgres") {
        await database.run("SELECT pg_advisory_xact_lock_shared(hashtext($1))", [
          "northstar_demo_data_v1",
        ]);
      }
      const resetState = await database.get<{ reset_in_progress: boolean | number }>(
        northstarSql({
          postgres: "SELECT reset_in_progress FROM demo_state WHERE singleton = true",
          sqlite: "SELECT reset_in_progress FROM demo_state WHERE singleton = 1",
        }),
      );
      if (resetState?.reset_in_progress === true || Number(resetState?.reset_in_progress) === 1) {
        throw new ActionHttpError(
          "Demo data is being reset. Try again after signing in.",
          409,
          "DEMO_RESET_IN_PROGRESS",
        );
      }
      const activeSession = await database.get<{ active: number }>(
        northstarSql({
          postgres: `SELECT 1 AS active
                       FROM northstar_sessions
                      WHERE token_hash LIKE $1
                        AND revoked_at IS NULL
                        AND expires_at > now()`,
          sqlite: `SELECT 1 AS active
                     FROM northstar_sessions
                    WHERE token_hash LIKE ?
                      AND expires_at > strftime('%s','now')`,
        }),
        [`${user.session}%`],
      );
      if (!activeSession) {
        throw new ActionHttpError("Your session expired. Sign in again.", 401, "SESSION_EXPIRED");
      }
      const current = await findRecord(database, number, true);
      if (!current) throw new ActionHttpError("Record not found", 404);

      const authorization = authorizeNorthstarRecordAction(user, input.action, current);
      if (!authorization.allowed) {
        throw new ActionHttpError(
          authorization.message,
          authorization.status,
          authorization.code,
        );
      }

      await performAction(database, current, user, authorization.action, input);
    });
  } catch (error) {
    if (error instanceof ActionHttpError) {
      return NextResponse.json(
        { error: error.message, ...(error.code ? { code: error.code } : {}) },
        { status: error.status },
      );
    }
    if (error instanceof InvalidActionInput) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Northstar action failed", error);
    return NextResponse.json(
      { error: "The action could not be completed." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
  });
}

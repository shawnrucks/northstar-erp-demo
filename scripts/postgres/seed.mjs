import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { createPostgresClient } from "./client.mjs";

const SEED_VERSION = 1;
const RESET = process.argv.includes("--reset");
const PASSWORD = process.env.NORTHSTAR_DEMO_PASSWORD || "Demo123!";
const seedDate = process.env.NORTHSTAR_DEMO_DATE || new Date().toISOString().slice(0, 10);

if (!/^\d{4}-\d{2}-\d{2}$/.test(seedDate) || Number.isNaN(Date.parse(`${seedDate}T12:00:00Z`))) {
  throw new Error("NORTHSTAR_DEMO_DATE must be a valid YYYY-MM-DD date.");
}
if (RESET && process.env.ALLOW_DEMO_RESET !== "1") {
  throw new Error("Destructive reset refused. Set ALLOW_DEMO_RESET=1 and run again.");
}

const anchor = new Date(`${seedDate}T12:00:00Z`);
const date = (offset) => {
  const value = new Date(anchor);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
};
const passwordHash = (password) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
};

const people = [
  ["admin@northstar-demo.com", "Morgan Hayes", "ADMIN"],
  ["sales@northstar-demo.com", "Elena Torres", "SALES_COORDINATOR"],
  ["buyer@northstar-demo.com", "Caleb Wright", "BUYER"],
  ["planner@northstar-demo.com", "Priya Shah", "PRODUCTION_PLANNER"],
  ["operations@northstar-demo.com", "Taylor Reed", "OPERATIONS_ANALYST"],
  ["ap@northstar-demo.com", "Nina Foster", "ACCOUNTS_PAYABLE"],
  ["quality@northstar-demo.com", "Marcus Lee", "QUALITY_SPECIALIST"],
];

const records = [];
const add = (type, number, title, party, status, priority, owner, dueDate, data = {}) => {
  records.push({ type, number, title, party, status, priority, owner, dueDate, data });
};

add("CUSTOMER", "CUS-1007", "Apex Motion Systems", "Apex Motion Systems", "ACTIVE", "NORMAL", "Elena Torres", null, {
  industry: "Industrial Equipment", contact: "Laura Bennett", email: "laura.bennett@apexmotion.example", terms: "Net 30",
  requirements: ["Drawing revision required", "Material certification required", "Certificate of conformance required", "No substitutions without approval", "No partial shipments"],
});
const customerNames = ["Redwood Drives", "Titan Pump Systems", "Frontier Energy", "Canyon Equipment", "BluePeak Machinery", "Mesa Aerospace", "Vector Controls", "Ironwood Industrial", "Highline Hydraulics", "Pioneer Conveyance", "Atlas Commercial"];
customerNames.forEach((name, index) => add("CUSTOMER", `CUS-${1008 + index}`, name, name, "ACTIVE", "NORMAL", "Elena Torres", null, { industry: "Industrial Equipment" }));

add("RFQ", "RFQ-2026-1047", "Custom Mounting Bracket", "Apex Motion Systems", "MISSING_INFORMATION", "HIGH", "Elena Torres", date(5), { customer: "Apex Motion Systems", customerPart: "AMS-BR-442", item: "NS-BR-442", itemDescription: "Custom Mounting Bracket", quantity: 2500, requestedDelivery: date(45), drawingNumber: "AMS-442", drawingRevision: "", material: "A36 carbon steel", packaging: "", finish: "Black zinc plating", assignedEstimator: "Elena Torres", missing: ["Drawing revision", "Packaging requirement"], costLines: [] });
add("QUOTE", "QT-2026-1047", "Custom Mounting Bracket quotation", "Apex Motion Systems", "AWAITING_APPROVAL", "HIGH", "Elena Torres", date(5), { rfq: "RFQ-2026-1047", quantity: 2500, materialCost: 18750, outsideProcessing: 6500, laborHours: 220, laborRate: 42, machineHours: 180, machineRate: 65, setupCost: 2400, toolingCost: 4800, packagingCost: 1750, freight: 1200, scrapPct: 4, overhead: 7900, revenue: 88188, approval: "SALES_MANAGER" });
add("SALES_ORDER", "SO-41882", "2,500 × NS-BR-442", "Apex Motion Systems", "MATERIAL_PENDING", "HIGH", "Elena Torres", date(40), { customerPO: "AMS-PO-77192", quote: "QT-2026-1047", quantity: 2500, item: "NS-BR-442", holdReason: "Material shortage" });
add("WORK_ORDER", "WO-23891", "Custom Mounting Bracket", "Apex Motion Systems", "MATERIAL_PENDING", "HIGH", "Priya Shah", date(35), { salesOrder: "SO-41882", item: "NS-BR-442", quantity: 2500, location: "Denver Manufacturing", workCenter: "WC-CNC-04", materialStatus: "SHORTAGE", estimatedCompletion: date(37), delayReason: "Awaiting A36 steel" });
add("PURCHASE_ORDER", "PO-10482", "6,200 LB A36 Steel Sheet", "Summit Steel Supply", "AWAITING_CONFIRMATION", "URGENT", "Caleb Wright", date(12), { item: "A36 Steel Sheet", quantity: 6200, uom: "LB", unitCost: 1.18, requiredDate: date(12), promisedDate: "", confirmation: "AWAITING_RESPONSE", workOrder: "WO-23891", salesOrder: "SO-41882", contact: "orders@summitsteel.example", lastFollowup: "", nextFollowup: "" });
add("SHORTAGE", "MS-3021", "A36 Steel Sheet shortage", "Apex Motion Systems", "OPEN", "HIGH", "Priya Shah", date(10), { workOrder: "WO-23891", salesOrder: "SO-41882", item: "A36 Steel Sheet", required: 6200, denver: 1800, fortCollins: 2200, aurora: 900, available: 4900, shortage: 1300, po: "PO-10482", resolution: "" });
add("EXCEPTION", "PE-1187", "Material shortage threatens WO-23891", "Apex Motion Systems", "OPEN", "HIGH", "Priya Shah", date(8), { type: "MATERIAL_SHORTAGE", workOrder: "WO-23891", product: "NS-BR-442", productionImpact: "Work order cannot release", customerImpact: "Requested ship date at risk", estimatedCompletion: date(37), nextAction: "Expedite supplier confirmation" });
add("INVOICE", "INV-SUM-8821", "Summit Steel Supply invoice", "Summit Steel Supply", "PRICE_EXCEPTION", "HIGH", "Nina Foster", date(22), { po: "PO-10482", receipt: "RCV-20991", quantity: 6200, poUnitPrice: 1.18, invoiceUnitPrice: 1.27, receivedQuantity: 6200, acceptedQuantity: 6200, receiptDate: date(-1), freight: 95, tax: 0, total: 7969, hold: false, tolerance: 2 });
add("QUALITY_HOLD", "QH-4491", "Final inspection documentation missing", "Apex Motion Systems", "QUALITY_HOLD", "HIGH", "Marcus Lee", date(3), { salesOrder: "SO-41882", workOrder: "WO-23891" });

for (let i = 1; i <= 140; i += 1) add("SUPPLIER", `SUP-${String(i).padStart(4, "0")}`, i === 1 ? "Summit Steel Supply" : `Industrial Supplier ${i}`, "", i % 11 === 0 ? "CONDITIONAL" : "APPROVED", i % 8 === 0 ? "HIGH" : "NORMAL", "Caleb Wright", null, { qualityRating: 88 + (i % 10), onTimeRating: 82 + (i % 15) });
for (let i = 1; i <= 150; i += 1) add("ITEM", i === 1 ? "NS-BR-442" : `NS-${String(i).padStart(4, "0")}`, i === 1 ? "Custom Mounting Bracket" : `Manufactured Component ${i}`, "", "ACTIVE", "NORMAL", "Priya Shah", null, { standardCost: 10 + i * 0.65, standardLeadTimeDays: 30, onHand: 100 + i * 7 });
for (let i = 1; i <= 74; i += 1) add("RFQ", `RFQ-2026-${i <= 18 ? 1100 + i : 1200 + i}`, `Customer RFQ ${i}`, `Customer ${(i % 12) + 1}`, i < 7 ? "NEW" : i < 11 ? "MISSING_INFORMATION" : "ENGINEERING_REVIEW", i % 4 === 0 ? "HIGH" : "NORMAL", "Elena Torres", date((i % 20) + 1), { quantity: 100 + i * 10 });
for (let i = 1; i <= 49; i += 1) add("QUOTE", `QT-2026-${1200 + i}`, `Production quote ${i}`, `Customer ${(i % 12) + 1}`, i < 5 ? "AWAITING_APPROVAL" : "DRAFT", "NORMAL", "Elena Torres", date((i % 20) + 3), i === 1 ? { quantity: 250, leadTimeDays: 15, standardLeadTimeDays: 30, approval: "PRODUCTION_PLANNER", approvalRequirements: ["PRODUCTION_PLANNER"], approvalsCompleted: [] } : { quantity: 250, materialCost: 5000, revenue: 9000 });
for (let i = 1; i <= 99; i += 1) add("SALES_ORDER", `SO-${42000 + i}`, `Customer order ${i}`, `Customer ${(i % 12) + 1}`, i < 5 ? "ON_HOLD" : "CONFIRMED", "NORMAL", "Elena Torres", i <= 3 ? date(0) : date((i % 35) + 4), { quantity: 100 + i });
for (let i = 1; i <= 119; i += 1) add("PURCHASE_ORDER", `PO-${10500 + i}`, `Material order ${i}`, `Industrial Supplier ${(i % 140) + 1}`, i <= 15 ? "PAST_DUE" : i < 20 ? "AWAITING_CONFIRMATION" : "CONFIRMED", i < 4 ? "URGENT" : i <= 15 ? "HIGH" : "NORMAL", "Caleb Wright", i <= 15 ? date(-i) : date((i % 30) + 2), { confirmation: i < 12 || (i >= 16 && i < 27) ? "AWAITING_RESPONSE" : "CONFIRMED", unitCost: 2.5 + i });
for (let i = 1; i <= 89; i += 1) add("WORK_ORDER", `WO-${24000 + i}`, `Production job ${i}`, `Customer ${(i % 12) + 1}`, i < 5 ? "MATERIAL_PENDING" : i < 9 ? "IN_PROGRESS" : i < 13 ? "MATERIAL_PENDING" : "RELEASED", i < 5 ? "HIGH" : "NORMAL", "Priya Shah", date((i % 28) + 2), {});
for (let i = 1; i <= 19; i += 1) add("SHORTAGE", `MS-${3100 + i}`, `Material shortage ${i}`, `Customer ${(i % 12) + 1}`, "OPEN", "HIGH", "Priya Shah", date((i % 12) + 1), { required: 1000, available: 600, shortage: 400 });
for (let i = 1; i <= 9; i += 1) add("EXCEPTION", `PE-${1200 + i}`, `Production exception ${i}`, `Customer ${(i % 12) + 1}`, "OPEN", i < 4 ? "HIGH" : "NORMAL", "Priya Shah", date(i + 2), { type: "WORK_ORDER_BEHIND_SCHEDULE" });
for (let i = 1; i <= 7; i += 1) add("QUALITY_HOLD", `QH-${4500 + i}`, `Quality hold ${i}`, `Customer ${(i % 12) + 1}`, "QUALITY_HOLD", "HIGH", "Marcus Lee", date(i + 1), {});
for (let i = 1; i <= 6; i += 1) add("RTV", `RTV-${800 + i}`, `Supplier return ${i}`, `Industrial Supplier ${i}`, "AWAITING_RMA", "NORMAL", "Marcus Lee", date(i + 5), {});
for (let i = 1; i <= 8; i += 1) add("INVOICE", `INV-EX-${2200 + i}`, `Invoice exception ${i}`, `Industrial Supplier ${i}`, i % 2 ? "PRICE_EXCEPTION" : "MISSING_RECEIPT", "HIGH", "Nina Foster", date(i), { poUnitPrice: 10, invoiceUnitPrice: 10.8, tolerance: 2, hold: false });
for (let i = 1; i <= 300; i += 1) add("MATERIAL", `RM-${String(i).padStart(4, "0")}`, `Raw material or component ${i}`, "", "ACTIVE", "NORMAL", "Priya Shah", null, { standardCost: 17 + i * 0.1 });
for (let i = 1; i <= 1000; i += 1) add("INVENTORY_BALANCE", `BAL-${String(i).padStart(5, "0")}`, `Inventory balance ${i}`, "", "ACTIVE", "NORMAL", "Priya Shah", null, { item: `NS-${String((i % 150) + 1).padStart(4, "0")}`, location: ["Denver Manufacturing", "Fort Collins Fabrication", "Aurora Distribution"][i % 3], onHand: 100 + (i % 250), allocated: i % 40, available: 80 + (i % 200) });

function valuesSql(rowCount, width, firstParameter = 1) {
  return Array.from({ length: rowCount }, (_, row) => `(${Array.from({ length: width }, (__, column) => `$${firstParameter + row * width + column}`).join(",")})`).join(",");
}

if (records.length !== 2_090) {
  throw new Error(`Canonical demo record count is ${records.length}; expected 2090.`);
}

const relations = [
  ["CUS-1007", "RFQ-2026-1047", "CUSTOMER_REQUEST"], ["RFQ-2026-1047", "QT-2026-1047", "QUOTED_AS"], ["QT-2026-1047", "SO-41882", "CONVERTED_TO"], ["SO-41882", "WO-23891", "FULFILLED_BY"], ["WO-23891", "PO-10482", "SUPPLIED_BY"], ["PO-10482", "INV-SUM-8821", "BILLED_BY"], ["WO-23891", "MS-3021", "HAS_SHORTAGE"], ["MS-3021", "PE-1187", "CAUSED_EXCEPTION"], ["SO-41882", "QH-4491", "HAS_QUALITY_HOLD"],
];
const costLines = [
  ["MATERIAL", "A36 carbon steel", 1, 18750], ["OUTSIDE_PROCESSING", "Black zinc plating", 1, 6500], ["LABOR", "Direct labor", 220, 42], ["MACHINE", "CNC machine time", 180, 65], ["SETUP", "Production setup", 1, 2400], ["TOOLING", "Dedicated tooling", 1, 4800], ["PACKAGING", "Customer packaging", 1, 1750], ["FREIGHT", "Estimated freight", 1, 1200], ["OVERHEAD", "Applied overhead", 1, 7900],
];

async function insertRecordBatches(client, table = "records") {
  for (let offset = 0; offset < records.length; offset += 200) {
    const batch = records.slice(offset, offset + 200);
    const values = batch.flatMap((record) => table === "records"
      ? [record.type, record.number, record.title, record.party, record.status, record.priority, record.owner, record.dueDate, JSON.stringify(record.data)]
      : [record.number, record.type, record.title, record.party, record.status, record.priority, record.owner, record.dueDate, JSON.stringify(record.data)]);
    const columns = table === "records"
      ? "type, number, title, party, status, priority, owner, due_date, data"
      : "number, type, title, party, status, priority, owner, due_date, data";
    await client.query(`INSERT INTO ${table} (${columns}) VALUES ${valuesSql(batch.length, 9)}`, values);
  }
}

async function populateCanonicalTemplates(client) {
  await client.query("DELETE FROM northstar_demo_cost_line_templates");
  await client.query("DELETE FROM northstar_demo_relation_templates");
  await client.query("DELETE FROM northstar_demo_record_templates");
  await client.query("DELETE FROM northstar_demo_user_templates");

  const userValues = people.flatMap(([email, name, role]) => [email, name, role, passwordHash(PASSWORD)]);
  await client.query(
    `INSERT INTO northstar_demo_user_templates (email, name, role, password_hash)
     VALUES ${valuesSql(people.length, 4)}`,
    userValues,
  );
  await insertRecordBatches(client, "northstar_demo_record_templates");
  await client.query(
    `INSERT INTO northstar_demo_relation_templates (parent_number, child_number, relation_type)
     VALUES ${valuesSql(relations.length, 3)}`,
    relations.flat(),
  );
  const costValues = costLines.flatMap(([category, description, quantity, unitCost], index) => ["QT-2026-1047", category, description, quantity, unitCost, index]);
  await client.query(
    `INSERT INTO northstar_demo_cost_line_templates
       (record_number, category, description, quantity, unit_cost, sort_order)
     VALUES ${valuesSql(costLines.length, 6)}`,
    costValues,
  );
  await client.query(
    `INSERT INTO demo_state
       (singleton, seed_version, anchor_date, canonical_record_count, updated_at)
     VALUES (true, $1, $2, $3, now())
     ON CONFLICT (singleton) DO UPDATE
       SET seed_version = EXCLUDED.seed_version,
           anchor_date = EXCLUDED.anchor_date,
           canonical_record_count = EXCLUDED.canonical_record_count,
           updated_at = now()`,
    [SEED_VERSION, seedDate, records.length],
  );
}

async function insertSeedAudit(client) {
  const auditValues = [];
  const modules = ["RFQ", "Purchasing", "Production", "Inventory", "Quality"];
  const storyNumbers = ["RFQ-2026-1047", "QT-2026-1047", "PO-10482", "MS-3021", "PE-1187", "INV-SUM-8821", "QH-4491"];
  for (let i = 0; i < 300; i += 1) {
    const person = people[i % people.length];
    auditValues.push(person[1], person[2], modules[i % modules.length], "Record", storyNumbers[i % storyNumbers.length], i % 4 === 0 ? "Update" : "Create", i % 4 === 0 ? "status" : null, i % 4 === 0 ? "DRAFT" : null, i % 4 === 0 ? "OPEN" : null, "Seeded operational history", "seed-session", JSON.stringify({ seeded: true }));
  }
  for (let offset = 0; offset < 300; offset += 100) {
    const width = 12;
    const batchValues = auditValues.slice(offset * width, (offset + 100) * width);
    await client.query(`INSERT INTO audit_events (user_name, user_role, module, record_type, record_number, action, field_changed, previous_value, new_value, note, session_id, metadata) VALUES ${valuesSql(100, width)}`, batchValues);
  }
}

async function copyTemplatesToEmptyLiveTables(client) {
  await client.query(`INSERT INTO users (email, name, role, password_hash, active, credential_version)
    SELECT email, name, role, password_hash, active, credential_version
      FROM northstar_demo_user_templates ORDER BY email`);
  await client.query(`INSERT INTO records (type, number, title, party, status, priority, owner, due_date, data)
    SELECT type, number, title, party, status, priority, owner, due_date, data
      FROM northstar_demo_record_templates ORDER BY number`);
  await client.query(`INSERT INTO record_relations (parent_number, child_number, relation_type)
    SELECT parent_number, child_number, relation_type
      FROM northstar_demo_relation_templates ORDER BY parent_number, child_number, relation_type`);
  await client.query(`INSERT INTO record_cost_lines (record_number, category, description, quantity, unit_cost, sort_order)
    SELECT record_number, category, description, quantity, unit_cost, sort_order
      FROM northstar_demo_cost_line_templates ORDER BY record_number, sort_order`);
  await insertSeedAudit(client);
  await client.query(
    `INSERT INTO northstar_meta (key, value) VALUES ('demo_seed', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify({ version: SEED_VERSION, anchorDate: seedDate, recordCount: records.length, generation: 0 })],
  );
}

function resetCooldownSeconds() {
  const requested = Number(process.env.NORTHSTAR_DEMO_RESET_COOLDOWN_SECONDS);
  if (!Number.isInteger(requested)) return 300;
  return Math.max(0, Math.min(86_400, requested));
}

async function reserveCliReset(client, runId, idempotencyKey) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["northstar_demo_data_v1"]);
    const stateResult = await client.query(
      `SELECT reset_in_progress, active_reset_run_id, last_reset_started_at, cooldown_until
         FROM demo_state WHERE singleton = true FOR UPDATE`,
    );
    const state = stateResult.rows[0];
    if (!state) throw new Error("Canonical demo state is unavailable.");
    if (state.reset_in_progress) {
      const stale = state.last_reset_started_at
        && Date.now() - new Date(state.last_reset_started_at).getTime() > 15 * 60 * 1000;
      if (!stale) throw new Error("Another demo reset is already running.");
      await client.query(
        `UPDATE demo_reset_runs SET status='FAILED', completed_at=now(), error_code='INTERRUPTED'
          WHERE id=$1 AND status='RUNNING'`,
        [state.active_reset_run_id],
      );
      await client.query(
        `UPDATE demo_state SET reset_in_progress=false, active_reset_run_id=NULL, updated_at=now()
          WHERE singleton=true`,
      );
    }
    if (state.cooldown_until && new Date(state.cooldown_until).getTime() > Date.now()) {
      throw new Error("The demo reset cooldown is still active.");
    }
    await client.query(
      `INSERT INTO demo_reset_runs
        (id,idempotency_key,status,requested_by,requested_by_role,requested_session,metadata)
       VALUES($1,$2,'RUNNING','Northstar Deployment','ADMIN','cli-reset',$3::jsonb)`,
      [runId, idempotencyKey, JSON.stringify({ source: "cli" })],
    );
    await client.query(
      `UPDATE demo_state
          SET reset_in_progress=true, active_reset_run_id=$1,
              last_reset_started_at=now(), updated_at=now()
        WHERE singleton=true`,
      [runId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function applyCliReset(client, runId) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('northstar.demo_reset', 'on', true)");
    const result = await client.query(
      "SELECT * FROM northstar_apply_demo_templates($1,$2,$3,$4,$5)",
      [runId, "Northstar Deployment", "ADMIN", "cli-reset", resetCooldownSeconds()],
    );
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    await client.query("BEGIN");
    try {
      await client.query(
        `UPDATE demo_reset_runs
            SET status='FAILED', completed_at=now(), error_code='RESET_FAILED'
          WHERE id=$1 AND status='RUNNING'`,
        [runId],
      );
      await client.query(
        `UPDATE demo_state
            SET reset_in_progress=false, active_reset_run_id=NULL, updated_at=now()
          WHERE singleton=true AND active_reset_run_id=$1`,
        [runId],
      );
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK").catch(() => {});
    }
    throw error;
  }
}

const client = createPostgresClient(RESET ? "northstar-reset" : "northstar-seed");
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["northstar_demo_seed_v1"]);
  await populateCanonicalTemplates(client);

  const existingSeed = await client.query("SELECT value FROM northstar_meta WHERE key = 'demo_seed'");
  if (!RESET && existingSeed.rowCount === 0) {
    const existingRecords = await client.query("SELECT count(*)::integer AS count FROM records");
    if (existingRecords.rows[0].count > 0) {
      throw new Error("Refusing to seed a non-empty database without --reset.");
    }
    await copyTemplatesToEmptyLiveTables(client);
  }
  await client.query("COMMIT");

  if (RESET) {
    const runId = randomUUID();
    await reserveCliReset(client, runId, `cli:${runId}`);
    const result = await applyCliReset(client, runId);
    console.log(`PostgreSQL demo reset complete: ${result.restored_record_count} canonical records; audit history retained.`);
  } else if (existingSeed.rowCount > 0) {
    console.log(`PostgreSQL demo seed already exists; refreshed ${records.length} canonical reset templates without changing live data.`);
  } else {
    console.log(`PostgreSQL demo seed complete: ${records.length} records, ${people.length} users, 300 audit events.`);
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("PostgreSQL seed failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}

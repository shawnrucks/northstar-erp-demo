import { randomBytes, scryptSync } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";

const SEED_VERSION = 1;
const EXPECTED_RECORD_COUNT = 2_090;
const PASSWORD = process.env.NORTHSTAR_DEMO_PASSWORD || "Demo123!";
const ADMIN_PASSWORD = process.env.NORTHSTAR_ADMIN_PASSWORD || PASSWORD;
const seedDate = process.env.NORTHSTAR_DEMO_DATE || new Date().toISOString().slice(0, 10);

if (process.env.NODE_ENV === "production" && ADMIN_PASSWORD === PASSWORD) {
  throw new Error("NORTHSTAR_ADMIN_PASSWORD must be set to an owner-only value in production.");
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(seedDate) || Number.isNaN(Date.parse(`${seedDate}T12:00:00Z`))) {
  throw new Error("NORTHSTAR_DEMO_DATE must be a valid YYYY-MM-DD date.");
}

const databasePath = resolve(
  process.env.NORTHSTAR_DATABASE_PATH || "data/northstar.sqlite3",
);
mkdirSync(dirname(databasePath), { recursive: true });
const db = new Database(databasePath);
db.pragma("foreign_keys = OFF");

db.exec(`
  DROP TABLE IF EXISTS northstar_sessions;
  DROP TABLE IF EXISTS report_records;
  DROP TABLE IF EXISTS reports;
  DROP TABLE IF EXISTS tasks;
  DROP TABLE IF EXISTS communications;
  DROP TABLE IF EXISTS notes;
  DROP TABLE IF EXISTS record_cost_lines;
  DROP TABLE IF EXISTS record_relations;
  DROP TABLE IF EXISTS audit_events;
  DROP TABLE IF EXISTS records;
  DROP TABLE IF EXISTS users;
  DROP TABLE IF EXISTS northstar_demo_cost_line_templates;
  DROP TABLE IF EXISTS northstar_demo_relation_templates;
  DROP TABLE IF EXISTS northstar_demo_record_templates;
  DROP TABLE IF EXISTS northstar_demo_user_templates;
  DROP TABLE IF EXISTS demo_reset_runs;
  DROP TABLE IF EXISTS demo_state;
  DROP TABLE IF EXISTS northstar_meta;

  CREATE TABLE northstar_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    credential_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE records (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL,
    number TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    party TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'NORMAL',
    owner TEXT NOT NULL DEFAULT '',
    due_date TEXT,
    data TEXT NOT NULL DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX records_type_status ON records(type, status);
  CREATE INDEX records_priority_due_date ON records(priority, due_date);
  CREATE INDEX records_owner_status ON records(owner, status);

  CREATE TABLE record_relations (
    id INTEGER PRIMARY KEY,
    parent_number TEXT NOT NULL REFERENCES records(number) ON UPDATE CASCADE ON DELETE CASCADE,
    child_number TEXT NOT NULL REFERENCES records(number) ON UPDATE CASCADE ON DELETE CASCADE,
    relation_type TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(parent_number, child_number, relation_type)
  );
  CREATE INDEX record_relations_child ON record_relations(child_number, relation_type);

  CREATE TABLE record_cost_lines (
    id INTEGER PRIMARY KEY,
    record_number TEXT NOT NULL REFERENCES records(number) ON UPDATE CASCADE ON DELETE CASCADE,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 1,
    unit_cost REAL NOT NULL DEFAULT 0,
    extended_cost REAL GENERATED ALWAYS AS (round(quantity * unit_cost, 2)) STORED,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX record_cost_lines_record ON record_cost_lines(record_number, sort_order, id);

  CREATE TABLE communications (
    id INTEGER PRIMARY KEY,
    record_number TEXT NOT NULL REFERENCES records(number) ON UPDATE CASCADE ON DELETE CASCADE,
    direction TEXT NOT NULL DEFAULT 'OUTBOUND',
    recipient TEXT NOT NULL DEFAULT '',
    sender TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    template TEXT,
    sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL DEFAULT 'SENT',
    created_by TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX communications_record_sent ON communications(record_number, sent_at DESC);

  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    record_number TEXT NOT NULL REFERENCES records(number) ON UPDATE CASCADE ON DELETE CASCADE,
    assigned_user TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT 'NORMAL',
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'OPEN',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX tasks_record_status ON tasks(record_number, status);

  CREATE TABLE notes (
    id INTEGER PRIMARY KEY,
    record_number TEXT NOT NULL REFERENCES records(number) ON UPDATE CASCADE ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX notes_record_created ON notes(record_number, created_at DESC);

  CREATE TABLE reports (
    id INTEGER PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    report_date TEXT NOT NULL,
    prepared_by TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    executive_summary TEXT NOT NULL DEFAULT '',
    management_decisions TEXT NOT NULL DEFAULT '',
    narratives TEXT NOT NULL DEFAULT '{}',
    included_records TEXT NOT NULL DEFAULT '[]',
    internal_notes TEXT NOT NULL DEFAULT '',
    metrics TEXT NOT NULL DEFAULT '{}',
    finalized_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE report_records (
    report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    record_number TEXT NOT NULL REFERENCES records(number) ON UPDATE CASCADE,
    included_by TEXT NOT NULL,
    included_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(report_id, record_number)
  );

  CREATE TABLE northstar_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_version TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    user_agent TEXT
  );
  CREATE INDEX northstar_sessions_expiry ON northstar_sessions(expires_at);

  CREATE TABLE audit_events (
    id INTEGER PRIMARY KEY,
    timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    user TEXT NOT NULL,
    user_role TEXT NOT NULL,
    module TEXT NOT NULL,
    record_type TEXT NOT NULL,
    record_number TEXT NOT NULL,
    action TEXT NOT NULL,
    field_changed TEXT,
    previous_value TEXT,
    new_value TEXT,
    note TEXT,
    session_id TEXT NOT NULL
  );
  CREATE INDEX audit_events_record_time ON audit_events(record_number, timestamp DESC);

  CREATE TABLE northstar_demo_user_templates (
    email TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    credential_version INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE northstar_demo_record_templates (
    number TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    party TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'NORMAL',
    owner TEXT NOT NULL DEFAULT '',
    due_date TEXT,
    data TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE northstar_demo_relation_templates (
    parent_number TEXT NOT NULL REFERENCES northstar_demo_record_templates(number) ON DELETE CASCADE,
    child_number TEXT NOT NULL REFERENCES northstar_demo_record_templates(number) ON DELETE CASCADE,
    relation_type TEXT NOT NULL,
    PRIMARY KEY(parent_number, child_number, relation_type)
  );
  CREATE TABLE northstar_demo_cost_line_templates (
    record_number TEXT NOT NULL REFERENCES northstar_demo_record_templates(number) ON DELETE CASCADE,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 1,
    unit_cost REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(record_number, sort_order, category, description)
  );

  CREATE TABLE demo_reset_runs (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    requested_by TEXT NOT NULL,
    requested_by_role TEXT NOT NULL,
    requested_session TEXT NOT NULL,
    requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    record_count INTEGER,
    generation INTEGER,
    error_code TEXT,
    metadata TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX demo_reset_runs_requested_at ON demo_reset_runs(requested_at DESC);
  CREATE TABLE demo_state (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    seed_version INTEGER NOT NULL DEFAULT 0,
    anchor_date TEXT,
    canonical_record_count INTEGER NOT NULL DEFAULT 0,
    generation INTEGER NOT NULL DEFAULT 0,
    reset_in_progress INTEGER NOT NULL DEFAULT 0,
    active_reset_run_id TEXT,
    last_reset_started_at TEXT,
    last_reset_completed_at TEXT,
    last_reset_by TEXT,
    cooldown_until TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);
db.pragma("foreign_keys = ON");

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

if (records.length !== EXPECTED_RECORD_COUNT) {
  throw new Error(`Canonical demo record count is ${records.length}; expected ${EXPECTED_RECORD_COUNT}.`);
}

const relations = [
  ["CUS-1007", "RFQ-2026-1047", "CUSTOMER_REQUEST"],
  ["RFQ-2026-1047", "QT-2026-1047", "QUOTED_AS"],
  ["QT-2026-1047", "SO-41882", "CONVERTED_TO"],
  ["SO-41882", "WO-23891", "FULFILLED_BY"],
  ["WO-23891", "PO-10482", "SUPPLIED_BY"],
  ["PO-10482", "INV-SUM-8821", "BILLED_BY"],
  ["WO-23891", "MS-3021", "HAS_SHORTAGE"],
  ["MS-3021", "PE-1187", "CAUSED_EXCEPTION"],
  ["SO-41882", "QH-4491", "HAS_QUALITY_HOLD"],
];
const costLines = [
  ["MATERIAL", "A36 carbon steel", 1, 18750],
  ["OUTSIDE_PROCESSING", "Black zinc plating", 1, 6500],
  ["LABOR", "Direct labor", 220, 42],
  ["MACHINE", "CNC machine time", 180, 65],
  ["SETUP", "Production setup", 1, 2400],
  ["TOOLING", "Dedicated tooling", 1, 4800],
  ["PACKAGING", "Customer packaging", 1, 1750],
  ["FREIGHT", "Estimated freight", 1, 1200],
  ["OVERHEAD", "Applied overhead", 1, 7900],
];

const populate = db.transaction(() => {
  const insertUserTemplate = db.prepare(`INSERT INTO northstar_demo_user_templates
    (email, name, role, password_hash) VALUES (?, ?, ?, ?)`);
  for (const [email, name, role] of people) {
    insertUserTemplate.run(
      email,
      name,
      role,
      passwordHash(role === "ADMIN" ? ADMIN_PASSWORD : PASSWORD),
    );
  }

  const insertRecordTemplate = db.prepare(`INSERT INTO northstar_demo_record_templates
    (type, number, title, party, status, priority, owner, due_date, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const record of records) {
    insertRecordTemplate.run(
      record.type,
      record.number,
      record.title,
      record.party,
      record.status,
      record.priority,
      record.owner,
      record.dueDate,
      JSON.stringify(record.data),
    );
  }

  const insertRelationTemplate = db.prepare(`INSERT INTO northstar_demo_relation_templates
    (parent_number, child_number, relation_type) VALUES (?, ?, ?)`);
  for (const relation of relations) insertRelationTemplate.run(...relation);

  const insertCostTemplate = db.prepare(`INSERT INTO northstar_demo_cost_line_templates
    (record_number, category, description, quantity, unit_cost, sort_order)
    VALUES ('QT-2026-1047', ?, ?, ?, ?, ?)`);
  costLines.forEach((line, index) => insertCostTemplate.run(...line, index));

  db.exec(`
    INSERT INTO users (email, name, role, password_hash, active, credential_version)
    SELECT email, name, role, password_hash, active, credential_version
      FROM northstar_demo_user_templates ORDER BY email;
    INSERT INTO records (type, number, title, party, status, priority, owner, due_date, data)
    SELECT type, number, title, party, status, priority, owner, due_date, data
      FROM northstar_demo_record_templates ORDER BY number;
    INSERT INTO record_relations (parent_number, child_number, relation_type)
    SELECT parent_number, child_number, relation_type
      FROM northstar_demo_relation_templates ORDER BY parent_number, child_number, relation_type;
    INSERT INTO record_cost_lines (record_number, category, description, quantity, unit_cost, sort_order)
    SELECT record_number, category, description, quantity, unit_cost, sort_order
      FROM northstar_demo_cost_line_templates ORDER BY record_number, sort_order;
  `);

  const insertAudit = db.prepare(`INSERT INTO audit_events
    (user, user_role, module, record_type, record_number, action, field_changed,
     previous_value, new_value, note, session_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const modules = ["RFQ", "Purchasing", "Production", "Inventory", "Quality"];
  const storyNumbers = ["RFQ-2026-1047", "QT-2026-1047", "PO-10482", "MS-3021", "PE-1187", "INV-SUM-8821", "QH-4491"];
  for (let i = 0; i < 300; i += 1) {
    const person = people[i % people.length];
    insertAudit.run(
      person[1],
      person[2],
      modules[i % modules.length],
      "Record",
      storyNumbers[i % storyNumbers.length],
      i % 4 === 0 ? "Update" : "Create",
      i % 4 === 0 ? "status" : null,
      i % 4 === 0 ? "DRAFT" : null,
      i % 4 === 0 ? "OPEN" : null,
      "Seeded operational history",
      "seed-session",
    );
  }

  db.prepare(`INSERT INTO demo_state
    (singleton, seed_version, anchor_date, canonical_record_count)
    VALUES (1, ?, ?, ?)`)
    .run(SEED_VERSION, seedDate, EXPECTED_RECORD_COUNT);
  db.prepare("INSERT INTO northstar_meta(key, value) VALUES('demo_seed', ?)")
    .run(JSON.stringify({ version: SEED_VERSION, anchorDate: seedDate, recordCount: EXPECTED_RECORD_COUNT, generation: 0 }));
});

populate();
db.close();
console.log(`Northstar demo database reset: ${databasePath} (${records.length} records)`);

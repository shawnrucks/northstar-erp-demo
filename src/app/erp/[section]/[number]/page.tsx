import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Action, Badge, PageTitle } from "@/components/Northstar";
import { northstarRepository, northstarSql } from "@/lib/northstar";
import { getCurrentNorthstarUser } from "@/lib/northstar-auth";
import { calculateQuote, invoicePriceVariance } from "@/lib/northstar-domain";
import { formatNorthstarDate, formatNorthstarDateTime } from "@/lib/northstar-format";
import { authorizeNorthstarRecordAction, canViewNorthstarRecord, type NorthstarRecordAction } from "@/lib/northstar-permissions";

const formatMoney = (value: unknown) => Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
const humanize = (value: string) => value.replace(/([A-Z])/g, " $1").replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());

const routeForRecord = (number: string) => {
  if (number.startsWith("RFQ-")) return `/erp/rfqs/${number}`;
  if (number.startsWith("QT-")) return `/erp/quotes/${number}`;
  if (number.startsWith("SO-")) return `/erp/sales-orders/${number}`;
  if (number.startsWith("WO-")) return `/erp/work-orders/${number}`;
  if (number.startsWith("PO-")) return `/erp/purchase-orders/${number}`;
  if (number.startsWith("MS-")) return `/erp/material-shortages/${number}`;
  if (number.startsWith("PE-")) return `/erp/production-exceptions/${number}`;
  if (number.startsWith("INV-")) return `/erp/invoices/${number}`;
  return `/erp/records/${number}`;
};

export default async function RecordPage({ params }: { params: Promise<{ section?: string; number: string }> }) {
  const routeParams = await params;
  const number = routeParams.number;
  const section = routeParams.section || "records";
  const current = await northstarRepository.findRecord(decodeURIComponent(number));
  if (!current) notFound();
  const user = await getCurrentNorthstarUser();
  if (!user) redirect("/login");
  if (!canViewNorthstarRecord(user, current.type, current.data)) redirect("/erp/dashboard");
  const plannerScopedQuote = user.role === "PRODUCTION_PLANNER" && current.type === "QUOTE";

  const data = current.data;
  const [audits, communications, tasks, notes] = await Promise.all([
    northstarRepository.all<Record<string, string | number | null>>(northstarSql({postgres:"SELECT id,timestamp,user_name AS user,user_role,action,field_changed,previous_value,new_value,note FROM audit_events WHERE record_number=$1 ORDER BY timestamp DESC,id DESC LIMIT 100",sqlite:"SELECT * FROM audit_events WHERE record_number=? ORDER BY timestamp DESC,id DESC LIMIT 100"}),[current.number]),
    northstarRepository.all<Record<string, string | number | null>>(northstarSql({postgres:"SELECT * FROM communications WHERE record_number=$1 ORDER BY sent_at DESC",sqlite:"SELECT * FROM communications WHERE record_number=? ORDER BY sent_at DESC"}),[current.number]),
    northstarRepository.all<Record<string, string | number | null>>(northstarSql({postgres:"SELECT * FROM tasks WHERE record_number=$1 ORDER BY id DESC",sqlite:"SELECT * FROM tasks WHERE record_number=? ORDER BY id DESC"}),[current.number]),
    northstarRepository.all<Record<string, string | number | null>>(northstarSql({postgres:"SELECT * FROM notes WHERE record_number=$1 ORDER BY created_at DESC,id DESC",sqlite:"SELECT * FROM notes WHERE record_number=? ORDER BY created_at DESC,id DESC"}),[current.number]),
  ]);
  const allowed = (action: NorthstarRecordAction) => authorizeNorthstarRecordAction(user, action, current).allowed;

  const actions: React.ReactNode[] = [];
  if (allowed("requestInfo")) actions.push(
    <Action key="requestInfo" number={current.number} action="requestInfo" label="Request Customer Information" fields={[
      { name: "recipient", label: "Recipient", value: "laura.bennett@apexmotion.example", required: true },
      { name: "message", label: "Editable message", type: "textarea", value: "Please provide the missing drawing revision and packaging requirements.", required: true },
    ]} />,
  );
  if (allowed("updateRfq")) actions.push(
    <Action key="updateRfq" number={current.number} action="updateRfq" label="Record Customer Response" fields={[
      { name: "customer", label: "Customer", value: String(data.customer || current.party), required: true },
      { name: "item", label: "Item or part number", value: String(data.item || ""), required: true },
      { name: "itemDescription", label: "Item description", value: String(data.itemDescription || current.title), required: true },
      { name: "quantity", label: "Quantity", type: "number", value: String(data.quantity || ""), required: true },
      { name: "requestedDelivery", label: "Requested delivery", type: "date", value: String(data.requestedDelivery || ""), required: true },
      { name: "quoteDueDate", label: "Quote due date", type: "date", value: String(data.quoteDueDate || current.due_date || ""), required: true },
      { name: "material", label: "Material", value: String(data.material || ""), required: true },
      { name: "drawingNumber", label: "Drawing number", value: String(data.drawingNumber || ""), required: true },
      { name: "assignedEstimator", label: "Assigned estimator", value: String(data.assignedEstimator || current.owner), required: true },
      { name: "drawingRevision", label: "Drawing revision", value: "C", required: true },
      { name: "packaging", label: "Packaging requirement", value: "25 units per reinforced carton", required: true },
    ]} />,
  );
  if (allowed("addCostLine")) actions.push(
    <Action key="addCostLine" number={current.number} action="addCostLine" label="Add Costing Line" fields={[
      { name: "category", label: "Category (MATERIAL, LABOR, TOOLING, etc.)", value: "MATERIAL", required: true },
      { name: "description", label: "Description", value: "A36 steel sheet", required: true },
      { name: "amount", label: "Amount", type: "number", value: "18750", required: true },
    ]} />,
  );
  if (allowed("createQuote")) actions.push(
    <Action key="createQuote" number={current.number} action="createQuote" label="Create Quote" fields={[
      { name: "quoteNumber", label: "Quote number", value: "QT-2026-1047", required: true },
      { name: "revenue", label: "Proposed revenue", type: "number", value: "88188", required: true },
      { name: "leadTimeDays", label: "Lead time (calendar days)", type: "number", value: "30", required: true },
    ]} />,
  );
  if (allowed("submitApproval")) actions.push(<Action key="submitApproval" number={current.number} action="submitApproval" label="Submit for Approval" />);
  const approvalRequirements = Array.isArray(data.approvalRequirements)
    ? data.approvalRequirements.map(String)
    : String(data.approval || "").split(",").filter(Boolean);
  const approvalsCompleted = new Set(Array.isArray(data.approvalsCompleted) ? data.approvalsCompleted.map(String) : []);
  const pendingApprovals = approvalRequirements.filter((approval) => approval !== "NONE" && !approvalsCompleted.has(approval));
  if (allowed("approve") && pendingApprovals.some((approval) => approval !== "PRODUCTION_PLANNER")) actions.push(<Action key="approve" number={current.number} action="approve" label="Approve Commercial Terms" />);
  if (allowed("plannerApprove") && pendingApprovals.includes("PRODUCTION_PLANNER")) actions.push(<Action key="plannerApprove" number={current.number} action="plannerApprove" label="Approve Lead Time" />);
  if (allowed("submitQuote")) actions.push(<Action key="submitQuote" number={current.number} action="submitQuote" label="Submit to Customer" />);
  if (allowed("supplierFollowup")) actions.push(
    <Action key="supplierFollowup" number={current.number} action="supplierFollowup" label="Send Supplier Follow-up" fields={[
      { name: "recipient", label: "Supplier contact", value: String(data.contact || ""), required: true },
      { name: "message", label: "Message", type: "textarea", value: "Please confirm pricing and the required delivery date.", required: true },
      { name: "nextFollowup", label: "Next follow-up date", type: "date" },
    ]} />,
  );
  if (allowed("confirmPO")) actions.push(
    <Action key="confirmPO" number={current.number} action="confirmPO" label="Record Confirmation" fields={[{ name: "promisedDate", label: "Revised promised date", type: "date", required: true }]} />,
  );
  if (allowed("transfer")) actions.push(
    <Action key="transfer" number={current.number} action="transfer" label="Create Transfer Request" fields={[
      { name: "from", label: "From location", value: "Fort Collins Fabrication", required: true },
      { name: "to", label: "Destination location", value: "Denver Manufacturing", required: true },
      { name: "quantity", label: "Quantity (LB)", type: "number", value: "2200", required: true },
    ]} />,
  );
  if (allowed("updateShortage")) actions.push(
    <Action key="updateShortage" number={current.number} action="updateShortage" label="Update Remaining Shortage" fields={[
      { name: "remainingShortage", label: "Remaining shortage (LB)", type: "number", value: String(data.shortage ?? 1300), required: true },
      { name: "resolution", label: "Resolution note", type: "textarea", required: true },
    ]} />,
  );
  if (allowed("escalate")) actions.push(<Action key="escalate" number={current.number} action="escalate" label="Escalate Remaining Shortage" tone="danger" />);
  if (allowed("updateException")) actions.push(
    <Action key="updateException" number={current.number} action="updateException" label="Update & Escalate" fields={[
      { name: "owner", label: "Owner", value: current.owner, required: true },
      { name: "priority", label: "Severity", value: current.priority, required: true },
      { name: "productionImpact", label: "Production impact", type: "textarea", value: String(data.productionImpact || ""), required: true },
      { name: "customerImpact", label: "Customer impact", type: "textarea", value: String(data.customerImpact || ""), required: true },
      { name: "estimatedCompletion", label: "Estimated completion", type: "date", value: String(data.estimatedCompletion || "") },
      { name: "status", label: "Status", value: "ESCALATED", required: true },
    ]} />,
  );
  if (allowed("includeInReport")) actions.push(<Action key="includeInReport" number={current.number} action="includeInReport" label="Include in Operations Report" />);
  if (allowed("confirmVariance")) actions.push(
    <Action key="confirmVariance" number={current.number} action="confirmVariance" label="Confirm Variance Review" fields={[{ name: "note", label: "Review note", type: "textarea", value: "Unit-price variance confirmed against the configured 2% tolerance.", required: true }]} />,
  );
  if (allowed("invoiceHold")) actions.push(<Action key="invoiceHold" number={current.number} action="invoiceHold" label="Place Invoice on Hold" tone="danger" />);
  if (allowed("creditRequest")) actions.push(
    <Action key="creditRequest" number={current.number} action="creditRequest" label="Request Supplier Credit" fields={[{ name: "message", label: "Message", type: "textarea", value: "The invoiced unit price exceeds PO-10482. Please issue a credit for the variance.", required: true }]} />,
  );
  if (allowed("task")) actions.push(
    <Action key="task" number={current.number} action="task" label={current.type === "EXCEPTION" ? "Create Customer-Service Task" : current.type === "INVOICE" ? "Request Buyer Review" : "Create Expedite Task"} fields={[
      { name: "title", label: "Task title", value: current.type === "INVOICE" ? `Review price variance on ${current.number}` : `Follow up on ${current.number}`, required: true },
      { name: "assignee", label: "Assigned user", value: current.type === "EXCEPTION" ? "Elena Torres" : current.owner, required: true },
      { name: "dueDate", label: "Due date", type: "date" },
    ]} />,
  );
  if (allowed("note")) actions.push(
    <Action key="note" number={current.number} action="note" label="Add Note" tone="secondary" fields={[{ name: "note", label: "Internal note", type: "textarea", required: true }]} />,
  );

  const quote = current.type === "QUOTE" && !plannerScopedQuote ? calculateQuote({
    materialCost: Number(data.materialCost || 0), outsideProcessing: Number(data.outsideProcessing || 0), laborHours: Number(data.laborHours || 0), laborRate: Number(data.laborRate || 0), machineHours: Number(data.machineHours || 0), machineRate: Number(data.machineRate || 0), setupCost: Number(data.setupCost || 0), toolingCost: Number(data.toolingCost || 0), packagingCost: Number(data.packagingCost || 0), freight: Number(data.freight || 0), scrapPct: Number(data.scrapPct || 0), overhead: Number(data.overhead || 0), revenue: Number(data.revenue || 0),
  }) : null;
  const invoiceVariance = current.type === "INVOICE" ? invoicePriceVariance(Number(data.poUnitPrice || 0), Number(data.invoiceUnitPrice || 0), Number(data.tolerance || 0)) : null;
  const related = Object.entries(data).filter(([key, value]) => /^(rfq|quote|salesOrder|workOrder|po|purchaseOrder)$/.test(key) && typeof value === "string");

  return (
    <div className="ns-page">
      <Link className="ns-back" href={plannerScopedQuote ? "/erp/quote-approvals" : `/erp/${section}`}>← Back to {plannerScopedQuote ? "quote approvals" : section.replaceAll("-", " ")}</Link>
      <PageTitle eyebrow={current.type.replaceAll("_", " ")} title={`${current.number} · ${current.title}`} subtitle={`Last updated ${formatNorthstarDateTime(current.updated_at)}`} actions={actions} />
      <div className="ns-record-meta">
        <div><small>Status</small><Badge>{current.status}</Badge></div>
        <div><small>Owner</small><b>{current.owner}</b></div>
        <div><small>Priority</small><Badge>{current.priority}</Badge></div>
        <div><small>Due date</small><b>{formatNorthstarDate(current.due_date, "Not set")}</b></div>
      </div>
      <nav className="ns-tabs" aria-label="Record sections">
        <a href="#overview">Overview</a>{!plannerScopedQuote && <><a href="#tasks">Tasks</a><a href="#communications">Communications</a><a href="#notes">Notes</a><a href="#audit">Audit History</a></>}
      </nav>

      {invoiceVariance && (
        <section className="ns-panel" aria-labelledby="match-title">
          <div className="ns-panel-head"><h2 id="match-title">Three-way match</h2><Badge>{invoiceVariance.outsideTolerance ? "OUTSIDE TOLERANCE" : "WITHIN TOLERANCE"}</Badge></div>
          <div className="ns-match">
            <div><h3>Purchase order</h3><p>PO <b><Link href={routeForRecord(String(data.po))}>{String(data.po)}</Link></b></p><p>Ordered quantity <b>{String(data.quantity)} LB</b></p><p>Unit price <b>{formatMoney(data.poUnitPrice)}</b></p></div>
            <div><h3>Receipt</h3><p>Receipt <b>{String(data.receipt)}</b></p><p>Received <b>{String(data.receivedQuantity)} LB</b></p><p>Accepted <b>{String(data.acceptedQuantity)} LB</b></p></div>
            <div className="variance"><h3>Invoice</h3><p>Invoiced quantity <b>{String(data.quantity)} LB</b></p><p>Unit price <b>{formatMoney(data.invoiceUnitPrice)}</b></p><p>Price variance <b>{invoiceVariance.variancePct.toFixed(2)}% (tolerance {String(data.tolerance)}%)</b></p></div>
          </div>
        </section>
      )}

      {quote && (
        <section className="ns-panel" aria-labelledby="cost-title">
          <div className="ns-panel-head"><h2 id="cost-title">Quote costing</h2><Badge>{approvalRequirements.includes("PRODUCTION_PLANNER") ? "PLANNER APPROVAL" : quote.grossMarginPct < 20 ? "EXECUTIVE APPROVAL" : quote.grossMarginPct < 30 ? "SALES MANAGER APPROVAL" : "STANDARD"}</Badge></div>
          <div className="ns-costs">
            <span>Material <b>{formatMoney(data.materialCost)}</b></span><span>Outside processing <b>{formatMoney(data.outsideProcessing)}</b></span><span>Labor <b>{formatMoney(quote.laborCost)}</b></span><span>Machine <b>{formatMoney(quote.machineCost)}</b></span><span>Scrap allowance <b>{formatMoney(quote.scrapCost)}</b></span><span>Total estimated cost <b>{formatMoney(quote.totalCost)}</b></span><span>Proposed revenue <b>{formatMoney(data.revenue)}</b></span><span>Gross margin <b>{quote.grossMarginPct.toFixed(2)}%</b></span>
          </div>
        </section>
      )}

      {plannerScopedQuote && (
        <section className="ns-panel" aria-labelledby="lead-time-title">
          <div className="ns-panel-head"><h2 id="lead-time-title">Lead-time approval</h2><Badge>{pendingApprovals.includes("PRODUCTION_PLANNER") ? "ACTION REQUIRED" : "COMPLETED"}</Badge></div>
          <div className="ns-costs">
            <span>Requested lead time <b>{String(data.leadTimeDays || "Not set")} days</b></span>
            <span>Standard lead time <b>{String(data.standardLeadTimeDays || "Not set")} days</b></span>
            <span>Requested delivery <b>{formatNorthstarDate(String(data.requestedDelivery || ""), "Not set")}</b></span>
            <span>Quote due <b>{formatNorthstarDate(current.due_date, "Not set")}</b></span>
          </div>
        </section>
      )}

      <div className="ns-detail-grid" id="overview">
        <section className="ns-panel">
          <div className="ns-panel-head"><h2>Record details</h2></div>
          {!plannerScopedQuote && related.length > 0 && <div className="ns-related"><h3>Related records</h3>{related.map(([key, value]) => <Link key={key} href={routeForRecord(String(value))}><small>{humanize(key)}</small><b>{String(value)} →</b></Link>)}</div>}
          <dl className="ns-details">{Object.entries(data).filter(([key, value]) => (!plannerScopedQuote || ["rfq", "item", "quantity", "leadTimeDays", "standardLeadTimeDays", "requestedDelivery"].includes(key)) && !Array.isArray(value) && typeof value !== "object").map(([key, value]) => <div key={key}><dt>{humanize(key)}</dt><dd>{String(value || "—")}</dd></div>)}</dl>
          {!plannerScopedQuote && Array.isArray(data.requirements) && <div className="ns-requirements"><h3>Requirements</h3>{data.requirements.map((value: string) => <p key={value}>✓ {value}</p>)}</div>}
          {!plannerScopedQuote && Array.isArray(data.missing) && data.missing.length > 0 && <div className="ns-warning"><b>Missing required information</b>{data.missing.map((value: string) => <p key={value}>! {value}</p>)}</div>}
          {!plannerScopedQuote && Array.isArray(data.costLines) && data.costLines.length > 0 && <div className="ns-subtable"><h3>RFQ costing lines</h3><table><thead><tr><th>Category</th><th>Description</th><th>Amount</th></tr></thead><tbody>{data.costLines.map((line: Record<string, unknown>) => <tr key={String(line.id)}><td>{String(line.category)}</td><td>{String(line.description)}</td><td>{formatMoney(line.amount)}</td></tr>)}</tbody></table></div>}
          {current.type === "SHORTAGE" && <div className="ns-subtable"><h3>Inventory by location</h3><table><thead><tr><th>Location</th><th>Available</th><th>Transfer action</th></tr></thead><tbody><tr><td>Denver Manufacturing</td><td>{String(data.denver)} LB</td><td>Primary demand location</td></tr><tr><td>Fort Collins Fabrication</td><td>{String(data.fortCollins)} LB</td><td>Transfer available</td></tr><tr><td>Aurora Distribution</td><td>{String(data.aurora)} LB</td><td>Transfer available</td></tr></tbody></table></div>}
          {Array.isArray(data.transfers) && data.transfers.map((transfer: Record<string, unknown>) => <div className="ns-success" key={String(transfer.number)}>{String(transfer.number)}: {String(transfer.quantity)} LB from {String(transfer.from)} to {String(transfer.to || "Denver Manufacturing")} · {String(transfer.status)}</div>)}
        </section>
        {!plannerScopedQuote && <aside>
          <section className="ns-panel" id="tasks"><div className="ns-panel-head"><h2>Tasks</h2></div>{tasks.length ? tasks.map((task) => <p className="ns-feed" key={String(task.id)}><b>{String(task.number)} · {String(task.title)}</b><small>{String(task.assigned_user)} · {String(task.status)}</small></p>) : <p className="ns-empty">No tasks recorded.</p>}</section>
          <section className="ns-panel" id="communications"><div className="ns-panel-head"><h2>Communications</h2></div>{communications.length ? communications.map((communication) => <p className="ns-feed" key={String(communication.id)}><b>{String(communication.subject)}</b><small>To {String(communication.recipient)} · {formatNorthstarDateTime(communication.sent_at)}</small></p>) : <p className="ns-empty">No communications recorded.</p>}</section>
          <section className="ns-panel" id="notes"><div className="ns-panel-head"><h2>Notes</h2></div>{notes.length ? notes.map((note) => <p className="ns-feed" key={String(note.id)}><b>{String(note.body)}</b><small>{String(note.created_by)} · {formatNorthstarDateTime(note.created_at)}</small></p>) : <p className="ns-empty">No internal notes recorded.</p>}</section>
        </aside>}
      </div>

      {!plannerScopedQuote && <section className="ns-panel" id="audit">
        <div className="ns-panel-head"><h2>Audit history</h2><span>Append-only event log</span></div>
        <table><thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Field</th><th>Previous</th><th>New value</th><th>Note</th></tr></thead><tbody>{audits.map((event) => <tr key={String(event.id)}><td>{formatNorthstarDateTime(event.timestamp)}</td><td>{String(event.user)}<small>{String(event.user_role)}</small></td><td>{String(event.action)}</td><td>{String(event.field_changed || "—")}</td><td>{String(event.previous_value || "—")}</td><td>{String(event.new_value || "—")}</td><td>{String(event.note || "—")}</td></tr>)}</tbody></table>
      </section>}
    </div>
  );
}

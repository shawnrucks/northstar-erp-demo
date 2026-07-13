import { expect, test } from "@playwright/test";
import { accounts, login, submitImmediateAction, submitModalAction, switchUser } from "./helpers";

test.describe.serial("Northstar connected workflows A-F", () => {
  test("Workflow A: RFQ intake, costing, quote approval, and submission", async ({ page }) => {
    await login(page, accounts.sales);
    await page.goto("/erp/rfqs/RFQ-2026-1047");
    await expect(page.getByText("Missing required information")).toBeVisible();
    await expect(page.getByText("! Drawing revision", { exact: true })).toBeVisible();

    await submitModalAction(page, "rfq-2026-1047-requestInfo-button", "Request Customer Information", {
      message: "Please provide revision C and reinforced-carton packaging requirements.",
    });
    await expect(page.getByText(/Information required for RFQ-2026-1047/)).toBeVisible();

    await submitModalAction(page, "rfq-2026-1047-updateRfq-button", "Record Customer Response", {
      drawingRevision: "C", packaging: "25 units per reinforced carton",
    });
    await expect(page.locator(".ns-record-meta").getByText("COSTING", { exact: true })).toBeVisible();

    await submitModalAction(page, "rfq-2026-1047-addCostLine-button", "Add Costing Line", {
      category: "MATERIAL", description: "A36 steel sheet", amount: "18750",
    });
    await expect(page.getByText("A36 steel sheet", { exact: true })).toBeVisible();
    await submitModalAction(page, "rfq-2026-1047-createQuote-button", "Create Quote", {
      quoteNumber: "QT-2026-1047", revenue: "88188",
    });
    await expect(page.locator("#overview").getByText("QT-2026-1047", { exact: true })).toBeVisible();

    await page.goto("/erp/quotes/QT-2026-1047");
    await expect(page.getByRole("heading", { name: "Quote costing" })).toBeVisible();
    await submitImmediateAction(page, "qt-2026-1047-submitApproval-button");
    await expect(page.locator(".ns-record-meta").getByText("AWAITING APPROVAL", { exact: true })).toBeVisible();

    await switchUser(page, accounts.admin);
    await page.goto("/erp/quotes/QT-2026-1047");
    await submitImmediateAction(page, "qt-2026-1047-approve-button");
    await expect(page.locator(".ns-record-meta").getByText("APPROVED", { exact: true })).toBeVisible();
    await submitImmediateAction(page, "qt-2026-1047-submitQuote-button");
    await expect(page.locator(".ns-record-meta").getByText("SUBMITTED", { exact: true })).toBeVisible();
    await expect(page.getByText(/Northstar quotation QT-2026-1047/)).toBeVisible();
  });

  test("Workflow B: supplier follow-up, confirmation, expedite task, and note", async ({ page }) => {
    await switchUser(page, accounts.buyer);
    await page.goto("/erp/queues/po-awaiting-confirmation");
    const row = page.getByRole("row").filter({ hasText: "PO-10482" });
    await expect(row).toBeVisible();
    await row.getByRole("link", { name: /open/i }).click();
    await submitModalAction(page, "po-10482-supplierFollowup-button", "Send Supplier Follow-up", {
      message: "Please confirm pricing and revised delivery.", nextFollowup: "2026-07-15",
    });
    await expect(page.getByText(/Confirmation requested: PO-10482/)).toBeVisible();
    await submitModalAction(page, "po-10482-confirmPO-button", "Record Confirmation", { promisedDate: "2026-07-20" });
    await submitModalAction(page, "po-10482-task-button", "Create Expedite Task", {
      title: "Expedite PO-10482 supplier confirmation", assignee: "Caleb Wright", dueDate: "2026-07-15",
    });
    await submitModalAction(page, "po-10482-note-button", "Add Note", { note: "Supplier committed to a revised date." });
    await expect(page.locator("#notes").getByText("Supplier committed to a revised date.", { exact: true })).toBeVisible();
  });

  test("Workflow C: shortage transfer, quantity update, expedite, and escalation", async ({ page }) => {
    await switchUser(page, accounts.planner);
    await page.goto("/erp/material-shortages/MS-3021");
    await expect(page.getByText("Fort Collins Fabrication", { exact: true })).toBeVisible();
    await submitModalAction(page, "ms-3021-transfer-button", "Create Transfer Request", { from: "Fort Collins Fabrication", quantity: "2200" });
    await expect(page.locator(".ns-success").filter({ hasText: "2200 LB from Fort Collins Fabrication" })).toBeVisible();
    await submitModalAction(page, "ms-3021-updateShortage-button", "Update Remaining Shortage", {
      remainingShortage: "1300", resolution: "Transfers submitted; remaining quantity tied to PO-10482.",
    });
    await submitModalAction(page, "ms-3021-task-button", "Create Expedite Task", { title: "Expedite remaining A36 shortage", assignee: "Caleb Wright" });
    await submitImmediateAction(page, "ms-3021-escalate-button");
    await expect(page.locator(".ns-record-meta").getByText("ESCALATED", { exact: true })).toBeVisible();
  });

  test("Workflow D: production exception ownership, customer task, and report inclusion", async ({ page }) => {
    await switchUser(page, accounts.operations);
    await page.goto("/erp/production-exceptions/PE-1187");
    await submitModalAction(page, "pe-1187-updateException-button", "Update & Escalate", {
      owner: "Taylor Reed", priority: "URGENT",
      productionImpact: "Work order release is blocked by A36 availability.",
      customerImpact: "The requested ship date is at risk.", estimatedCompletion: "2026-08-20", status: "ESCALATED",
    });
    await submitModalAction(page, "pe-1187-task-button", "Create Customer-Service Task", {
      title: "Prepare Apex Motion status update", assignee: "Elena Torres", dueDate: "2026-07-16",
    });
    await submitImmediateAction(page, "pe-1187-includeInReport-button");
    await expect(page.getByText("INCLUDE IN NEXT REPORT", { exact: false })).toBeVisible();
  });

  test("Workflow E: invoice reconciliation, hold, buyer review, credit, and note", async ({ page }) => {
    await switchUser(page, accounts.ap);
    await page.goto("/erp/invoices/INV-SUM-8821");
    await expect(page.getByText("7.63% (tolerance 2%)")).toBeVisible();
    await submitModalAction(page, "inv-sum-8821-confirmVariance-button", "Confirm Variance Review", {
      note: "Confirmed price variance exceeds configured tolerance.",
    });
    await submitImmediateAction(page, "inv-sum-8821-invoiceHold-button");
    await expect(page.getByText("ON HOLD", { exact: true })).toBeVisible();
    await submitModalAction(page, "inv-sum-8821-task-button", "Request Buyer Review", {
      title: "Review price variance on INV-SUM-8821", assignee: "Caleb Wright",
    });
    await submitModalAction(page, "inv-sum-8821-creditRequest-button", "Request Supplier Credit", {
      message: "Please issue a credit for the unit-price variance.",
    });
    await submitModalAction(page, "inv-sum-8821-note-button", "Add Note", { note: "Invoice held pending supplier credit." });
    await expect(page.locator("#notes").getByText("Invoice held pending supplier credit.", { exact: true })).toBeVisible();
  });

  test("Workflow F: select issues, save draft, finalize same report, and export PDF", async ({ page }) => {
    await switchUser(page, accounts.operations);
    await page.goto("/erp/reports/daily-operations");
    await expect(page.getByRole("heading", { name: "Live metrics snapshot" })).toBeVisible();
    const includeException = page.getByLabel("Include PE-1187");
    if (!(await includeException.isChecked())) await includeException.check();
    await expect(includeException).toBeChecked();
    await page.getByTestId("operations-report-summary").fill("A36 supply remains the primary risk to customer commitments.");
    await page.getByLabel("Production summary").fill("WO-23891 remains material constrained.");
    await page.getByLabel("Supply-chain summary").fill("PO-10482 requires supplier recovery.");
    await page.getByLabel("Required management decisions").fill("Caleb owns supplier recovery; Priya owns the transfer plan.");
    await page.getByTestId("operations-report-save-button").click();
    await expect(page.getByTestId("operations-report-status")).toHaveText("DRAFT");
    const reportNumber = await page.getByTestId("operations-report-number").textContent();
    expect(reportNumber).toMatch(/^DOR-/);

    await page.reload();
    await page.getByTestId(`operations-report-open-${reportNumber!.toLowerCase()}`).click();
    await expect(page.getByTestId("operations-report-summary")).toHaveValue("A36 supply remains the primary risk to customer commitments.");
    await expect(page.getByLabel("Include PE-1187")).toBeChecked();

    await page.getByTestId("operations-report-finalize-button").click();
    await expect(page.getByTestId("operations-report-status")).toHaveText("FINAL");
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("operations-report-export-link").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^DOR-.*\.pdf$/);
  });
});

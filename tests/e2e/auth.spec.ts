import { expect, test } from "@playwright/test";

import { accounts, login } from "./helpers";

test.describe("authentication and route protection", () => {
  test("redirects an anonymous visitor away from the ERP", async ({ page }) => {
    await page.goto("/erp/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("shows an error for an invalid password", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email address").selectOption(accounts.operations);
    await page.getByLabel("Password").fill("not-the-demo-password");
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page.getByText(/did not match|invalid email or password/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("signs in with a seeded account and logs out", async ({ page }) => {
    await login(page, accounts.operations);
    await expect(page.getByText("Taylor Reed").first()).toBeVisible();
    await expect(page.getByText("OPERATIONS ANALYST").first()).toBeVisible();

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("restricts ERP module routes to the signed-in role", async ({ page }) => {
    await login(page, accounts.operations);
    await page.goto("/erp/admin");
    await expect(page).toHaveURL(/\/erp\/dashboard$/);
  });

  for (const [email, route] of [
    [accounts.sales, "/erp/invoices"],
    [accounts.sales, "/erp/queues/invoice-exceptions"],
    [accounts.sales, "/erp/shipping"],
    [accounts.buyer, "/erp/customers"],
    [accounts.buyer, "/erp/invoices"],
    [accounts.planner, "/erp/customers"],
    [accounts.planner, "/erp/quotes"],
    [accounts.planner, "/erp/purchase-orders"],
    [accounts.ap, "/erp/rfqs"],
    [accounts.ap, "/erp/suppliers"],
    [accounts.quality, "/erp/invoices"],
    [accounts.quality, "/erp/suppliers"],
    [accounts.quality, "/erp/inventory"],
    [accounts.quality, "/erp/work-orders"],
  ] as const) {
    test(`prevents ${email} from opening unauthorized collection ${route}`, async ({ page }) => {
      await login(page, email);
      await page.goto(route);
      await expect(page).toHaveURL(/\/erp\/dashboard$/);
    });
  }

  test("gives planners a scoped lead-time approval queue without commercial quote access", async ({ page }) => {
    await login(page, accounts.planner);
    await page.goto("/erp/quote-approvals");
    await expect(page.getByText("QT-2026-1201", { exact: true })).toBeVisible();

    await page.goto("/erp/quotes/QT-2026-1202");
    await expect(page).toHaveURL(/\/erp\/dashboard$/);

    await page.goto("/erp/quotes/QT-2026-1201");
    await expect(page.getByRole("heading", { name: "Lead-time approval" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Quote costing" })).toHaveCount(0);
    await expect(page.getByText("Gross margin", { exact: true })).toHaveCount(0);
  });

  test("filters global search at the server for the signed-in role", async ({ page }) => {
    await login(page, accounts.sales);
    await page.goto("/erp/search?q=PO-10482");

    await expect(page.getByText("0 records")).toBeVisible();
    await expect(page.getByText("PO-10482", { exact: true })).toHaveCount(0);
  });

  test("serves each operational collection from the correct record type", async ({ page }) => {
    await login(page, accounts.admin);

    await page.goto("/erp/material-shortages");
    await expect(page.getByText("MS-3021", { exact: true })).toBeVisible();
    await expect(page.getByText("RFQ-2026-1047", { exact: true })).toHaveCount(0);

    await page.goto("/erp/production-exceptions");
    await expect(page.getByText("PE-1187", { exact: true })).toBeVisible();
    await expect(page.getByText("RFQ-2026-1047", { exact: true })).toHaveCount(0);

    await page.goto("/erp/quality/rtv");
    await expect(page.getByText("6 records")).toBeVisible();
  });

  test("loads complete seeded module datasets before client pagination", async ({ page }) => {
    await login(page, accounts.admin);

    await page.goto("/erp/suppliers");
    await expect(page.getByText("140 records")).toBeVisible();
    await page.goto("/erp/inventory");
    await expect(page.getByText("150 records")).toBeVisible();
    await page.goto("/erp/purchase-orders");
    await expect(page.getByText("120 records")).toBeVisible();
  });
});

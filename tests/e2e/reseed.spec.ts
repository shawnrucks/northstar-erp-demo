import { expect, test } from "@playwright/test";

import { accounts, login } from "./helpers";

test.skip(Boolean(process.env.NORTHSTAR_E2E_BASE_URL), "Reseed E2E runs only against the isolated local database.");

test("administrator can restore canonical demo data from the UI", async ({ page }) => {
  await login(page, accounts.admin);
  await page.goto("/erp/admin");

  await expect(page.getByRole("heading", { name: "Reset demo data" })).toBeVisible();
  await expect(page.getByText("2,090", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Operator reset token")).toHaveCount(0);
  await expect(page.getByText("RESET NORTHSTAR DEMO", { exact: true })).toHaveCount(0);

  const reset = page.getByTestId("northstar-demo-reset-button");
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(page.getByRole("status")).toContainText("2,090 records restored", {
    timeout: 20_000,
  });
  await expect(page).toHaveURL(/\/login\?reset=complete$/, { timeout: 10_000 });

  await login(page, accounts.sales);
  await page.goto("/erp/rfqs/RFQ-2026-1047");
  await expect(page.locator(".ns-record-meta").getByText("MISSING INFORMATION", { exact: true })).toBeVisible();
});

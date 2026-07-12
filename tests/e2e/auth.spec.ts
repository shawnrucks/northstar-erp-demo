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
});

import { expect, type Page } from "@playwright/test";

export const accounts = {
  admin: "admin@northstar-demo.com",
  sales: "sales@northstar-demo.com",
  buyer: "buyer@northstar-demo.com",
  planner: "planner@northstar-demo.com",
  operations: "operations@northstar-demo.com",
  ap: "ap@northstar-demo.com",
  quality: "quality@northstar-demo.com",
} as const;

export async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").selectOption(email);
  await page.getByLabel("Password").fill("Demo123!");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/erp\/dashboard$/);
}

export async function switchUser(page: Page, email: string) {
  await page.context().clearCookies();
  await login(page, email);
}

export async function submitModalAction(
  page: Page,
  testId: string,
  label: string,
  values: Record<string, string> = {},
) {
  await page.getByTestId(testId).click();
  const modal = page.locator(".ns-modal");
  await expect(modal).toBeVisible();

  for (const [field, value] of Object.entries(values)) {
    await modal.locator(`[name="${field}"]`).fill(value);
  }

  await modal.getByRole("button", { name: label, exact: true }).click();
  await expect(modal.getByText("Saved successfully")).toBeVisible();
  await expect(modal).toBeHidden({ timeout: 7_500 });
}

export async function submitImmediateAction(
  page: Page,
  testId: string,
) {
  await page.getByTestId(testId).click();
  await expect(page.getByText("Saved successfully")).toBeVisible();
  await expect(page.getByText("Saved successfully")).toBeHidden({
    timeout: 7_500,
  });
}

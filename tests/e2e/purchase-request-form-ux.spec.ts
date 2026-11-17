import { expect, test } from "@playwright/test";
import { signIn } from "./support";

test("PR review is explicit, preserves edits after cancel, and retains them after a failed submit", async ({ page }) => {
  await signIn(page);
  await page.goto("/purchase-requests/new");
  await page.locator("#reason").fill("Equipment for the packaging team");
  await page.locator('input[name="items.0.itemName"]').fill("Packaging tape");
  let writes = 0;
  await page.route("**/api/purchase-requests", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    writes++;
    await route.fulfill({ status: 500, json: { error: "Test save failed" } });
  });
  const submit = page.getByRole("button", { name: /บันทึกและส่งอนุมัติ|save and submit/i });
  await submit.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Packaging tape");
  await expect(dialog).toContainText(/ยังไม่ระบุราคา|price not specified/i);
  expect(writes).toBe(0);
  await dialog.getByRole("button", { name: /กลับไปแก้ไข|back to editing/i }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#reason")).toHaveValue("Equipment for the packaging team");
  await submit.click();
  await page.getByTestId("confirm-pr-submit").click();
  await expect(page.getByTestId("confirm-pr-submit")).toBeEnabled();
  expect(writes).toBe(1);
  await dialog.getByRole("button", { name: /กลับไปแก้ไข|back to editing/i }).click();
  await expect(page.locator('input[name="items.0.itemName"]')).toHaveValue("Packaging tape");
});

test("PR form protects unsaved edits on internal navigation and allows confirmed leaving", async ({ page }) => {
  await signIn(page);
  await page.goto("/purchase-requests/new");
  await page.locator("#reason").fill("Preserve unsaved purchase request details");
  const home = page.locator('nav a[href="/dashboard"]').first();
  page.once("dialog", (dialog) => dialog.dismiss());
  await home.click();
  await expect(page).toHaveURL(/\/purchase-requests\/new$/);
  await expect(page.locator("#reason")).toHaveValue("Preserve unsaved purchase request details");
  page.once("dialog", (dialog) => dialog.accept());
  await home.click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("mobile PR sections retain every field and distinguish a missing price from zero", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto("/purchase-requests/new");
  await page.getByRole("button", { name: /2\. รายการและไฟล์แนบ|2\. Items and attachments/i }).click();
  await expect(page.locator('input[name="items.0.itemName"]')).toBeVisible();
  await expect(page.locator('input[name="items.0.description"]')).toBeVisible();
  await expect(page.locator('input[name="items.0.supplierName"]')).toBeVisible();
  await expect(page.locator("#attachments")).toBeAttached();
  await expect(page.locator("#pr-form-review")).toContainText(/ยอดรวมเฉพาะรายการที่มีราคา|subtotal of priced items/i);
  await page.locator('input[name="items.0.unitPrice"]').fill("0");
  await expect(page.locator("#pr-form-review")).not.toContainText(/ยอดรวมเฉพาะรายการที่มีราคา|subtotal of priced items/i);
  const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
});

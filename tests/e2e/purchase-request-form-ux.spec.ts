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


test("adding and removing PR rows keeps the remaining item details on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto("/purchase-requests/new");
  await page.locator("#reason").fill("Synthetic item row regression");
  await page.getByRole("button", { name: /2\. รายการและไฟล์แนบ|2\. Items and attachments/i }).click();
  const items = page.getByTestId("pr-item-row");
  await expect(items).toHaveCount(1);
  await items.first().locator('input[name$=".itemName"]').fill("Spare item");
  await page.getByRole("button", { name: /^(เพิ่มรายการ|Add item)$/i }).click();
  await expect(items).toHaveCount(2);
  const retained = items.nth(1);
  for (const [field, value] of Object.entries({ itemName: "Packing tape", quantity: "3", unit: "roll", unitPrice: "12.50", description: "50 mm tape", supplierName: "Synthetic supplier" })) {
    await retained.locator(`input[name$=".${field}"]`).fill(value);
  }
  await items.first().getByRole("button", { name: /^(ลบรายการ|Remove item)$/i }).click();
  await expect(items).toHaveCount(1);
  for (const [field, value] of Object.entries({ itemName: "Packing tape", quantity: "3", unit: "roll", unitPrice: "12.50", description: "50 mm tape", supplierName: "Synthetic supplier" })) {
    await expect(items.first().locator(`input[name$=".${field}"]`)).toHaveValue(value);
  }
  await expect(items.first().locator('input[id$="-total"]')).toHaveValue(/37\.50/);
});

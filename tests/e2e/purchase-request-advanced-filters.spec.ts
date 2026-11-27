import { expect, test } from "@playwright/test";

import { authenticate } from "./receipt-support";

test("advanced PR filters stay out of the way and survive search on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await authenticate(page);
  await page.goto("/purchase-requests");
  const advanced = page.getByTestId("pr-advanced-filters");
  const toggle = advanced.locator("summary");
  await expect(page.locator("#query")).toBeVisible();
  await expect(page.locator("#status")).toBeVisible();
  await expect(page.locator("#department")).toBeHidden();
  await toggle.click();
  await page.locator("#department").selectOption("Operations");
  await page.locator("#from").fill("2026-11-01");
  await page.locator("#to").fill("2026-11-30");
  await page.locator("#urgency").selectOption("HIGH");
  await page.locator("#sort").selectOption("pr_asc");
  await toggle.click();
  await expect(page.locator("#from")).toBeHidden();
  await page.getByRole("button", { name: /^(ค้นหา|Search)$/i }).click();
  await expect(page).toHaveURL(/department=Operations/);
  const applied = new URL(page.url()).searchParams;
  expect(Object.fromEntries(["from", "to", "urgency", "sort"].map(key => [key, applied.get(key)]))).toEqual({
    from: "2026-11-01", to: "2026-11-30", urgency: "HIGH", sort: "pr_asc",
  });
  await expect(toggle).toHaveText(/(?:ตัวกรองเพิ่มเติม|More filters)4/);
  await expect(page.locator("#department")).toBeHidden();
  await toggle.click();
  await expect(page.locator("#department")).toHaveValue("Operations");
  await expect(page.locator("#sort")).toHaveValue("pr_asc");
  await page.getByRole("link", { name: /^(ล้างตัวกรอง|Clear filters)$/i }).click();
  await expect(page).toHaveURL(/\/purchase-requests$/);
  await expect(page.locator("#department")).toBeHidden();
  await toggle.click();
  await expect(page.locator("#department")).toHaveValue("ALL");
  await expect(page.locator("#sort")).toHaveValue("updated_desc");
});

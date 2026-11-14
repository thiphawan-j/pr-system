import { expect, test } from "@playwright/test";
import { credentials, signIn } from "./support";

const paths = ["/dashboard", "/purchase-requests", "/purchase-requests/new", "/reports", "/purchase-orders/new", "/suppliers", "/admin/users", "/admin/company"];

test("desktop sidebar preserves all admin menus and exactly one active link", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, credentials.admin);
  const sidebar = page.locator("[data-desktop-navigation]");
  for (const path of paths) {
    await expect(sidebar.locator(`nav a[href="${path}"]`)).toBeVisible();
  }
  await sidebar.locator('nav a[href="/purchase-requests/new"]').click();
  await expect(page).toHaveURL(/\/purchase-requests\/new$/);
  await expect(sidebar.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(sidebar.locator('[aria-current="page"]')).toHaveAttribute("href", "/purchase-requests/new");
  await page.goBack();
  await expect(sidebar.locator('[aria-current="page"]')).toHaveAttribute("href", "/dashboard");
});

test("mobile drawer closes on selection or Escape and keeps menus reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, credentials.admin);
  const trigger = page.getByRole("button", { name: /เปิดเมนูนำทาง|open navigation menu/i });
  await expect(page.locator("[data-desktop-navigation]")).toBeHidden();
  await trigger.click();
  const drawer = page.getByRole("dialog");
  for (const path of paths) {
    await expect(drawer.locator(`nav a[href="${path}"]`)).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await drawer.locator('nav a[href="/suppliers"]').click();
  await expect(page).toHaveURL(/\/suppliers$/);
  await expect(drawer).toBeHidden();
  await trigger.click();
  await expect(drawer.locator('[aria-current="page"]')).toHaveAttribute("href", "/suppliers");
  await page.keyboard.press("Escape");
  expect(await page.locator("body").evaluate((body) => body.scrollWidth)).toBeLessThanOrEqual(390);
});

test("employee navigation does not reveal purchasing or administration groups", async ({ page }) => {
  await signIn(page, credentials.employee);
  const sidebar = page.locator("[data-desktop-navigation]");
  await expect(sidebar.locator("nav a")).toHaveCount(4);
  for (const path of paths.slice(4)) {
    await expect(sidebar.locator(`nav a[href="${path}"]`)).toHaveCount(0);
  }
});

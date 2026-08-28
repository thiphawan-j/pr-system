import { expect, test } from "@playwright/test";

import {
  createRequestViaApi,
  credentials,
  signIn,
  signOut,
  switchUser,
} from "./support";

test("guest is redirected and invalid credentials are rejected", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("#identifier")).toHaveValue("employee@demo.local");

  await page.locator("#identifier").fill("unknown-user");
  await page.locator("#password").fill("WrongPassw0rd!");
  const loginResponse = page.waitForResponse(
    (response) => response.url().endsWith("/api/auth/login"),
  );
  await page.getByRole("button", { name: /เข้าสู่ระบบ|sign in/i }).click();

  expect((await loginResponse).status()).toBe(401);
  await expect(page).toHaveURL(/\/login$/);
});

test("user can sign in with email, username, and phone", async ({ page }) => {
  for (const account of [
    credentials.employeeByEmail,
    credentials.employee,
    credentials.employeeByPhone,
  ]) {
    await signIn(page, account);
    await expect(page).toHaveURL(/\/dashboard$/);
    await signOut(page);
  }
});

test("role navigation hides admin and server rejects unauthorized admin access", async ({
  page,
}) => {
  await signIn(page);

  await expect(page.locator('header a[href="/admin/users"]')).toHaveCount(0);
  const apiResponse = await page.request.get("/api/admin/users?page=1&limit=10");
  expect(apiResponse.status()).toBe(403);

  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/dashboard$/);

  await switchUser(page, credentials.admin);
  await expect(page.locator('header a[href="/admin/users"]')).toBeVisible();
  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    /จัดการผู้ใช้งาน|user management/i,
  );
});

test("user can switch the application language", async ({ page }) => {
  await signIn(page);

  await page.getByRole("button", { name: "ภาษา: English" }).click();
  await expect(page.locator('header a[href="/reports"]')).toHaveText("Reports");
  await expect(page.getByRole("button", { name: "Language: ไทย" })).toBeVisible();

  await page.getByRole("button", { name: "Language: ไทย" }).click();
  await expect(page.locator('header a[href="/reports"]')).toHaveText("รายงาน");
});

test("notification opens its request and is marked as read", async ({ page }) => {
  await signIn(page);
  const request = await createRequestViaApi(page, { submit: true });

  await switchUser(page, credentials.approver);
  await page.getByRole("button", { name: /การแจ้งเตือน|notifications/i }).click();
  const notification = page.getByRole("menuitem").filter({
    hasText: request.prNumber,
  });
  await expect(notification).toBeVisible();
  const readResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/notifications/") &&
      response.url().endsWith("/read"),
  );
  await notification.click();
  expect((await readResponse).status()).toBe(200);

  await expect(page).toHaveURL(new RegExp(`${request.url}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    request.prNumber,
    { timeout: 15_000 },
  );
});

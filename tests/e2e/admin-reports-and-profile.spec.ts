import { expect, test } from "@playwright/test";

import {
  createRequestViaApi,
  credentials,
  signIn,
  signOut,
  switchUser,
  uniqueValue,
} from "./support";

test("admin can create, edit, reset, disable, and enable a user", async ({ page }) => {
  await signIn(page, credentials.admin);
  await page.goto("/admin/users");

  const suffix = `${Date.now()}`.slice(-7);
  const employeeCode = `E2E${suffix}`;
  const username = `e2e${suffix}`;
  const phone = `089${suffix}`;
  const email = `${username}@demo.local`;
  const initialPassword = "InitialPassw0rd!";
  const resetPassword = "ResetPassw0rd!";

  await page.locator("#employeeCode").fill(employeeCode);
  await page.locator("#name").fill(`E2E User ${suffix}`);
  await page.locator("#username").fill(username);
  await page.locator("#phone").fill(phone);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(initialPassword);
  await page.locator("#title").fill("E2E Tester");
  const createUserResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/admin/users") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /สร้างผู้ใช้งาน|create user/i }).click();
  expect((await createUserResponse).status()).toBe(201);

  const row = page.locator("table tbody tr").filter({ hasText: email });
  await expect(row).toHaveCount(1);

  await row.getByRole("button", { name: /แก้ไขข้อมูล|edit user/i }).click();
  await page.locator("#edit-name").fill(`Updated E2E User ${suffix}`);
  const editUserResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/admin/users/") &&
      response.request().method() === "PATCH",
  );
  await page.getByRole("dialog").getByRole("button", {
    name: /บันทึกการแก้ไข|save changes/i,
  }).click();
  expect((await editUserResponse).status()).toBe(200);
  await expect(row).toContainText(`Updated E2E User ${suffix}`);

  await row.getByRole("button", { name: /รีเซ็ตรหัสผ่าน|reset password/i }).click();
  await page.locator("#reset-newPassword").fill(resetPassword);
  await page.locator("#reset-confirmPassword").fill(resetPassword);
  const resetPasswordResponse = page.waitForResponse(
    (response) => response.url().endsWith("/reset-password"),
  );
  await page.getByRole("dialog").getByRole("button", {
    name: /รีเซ็ตรหัสผ่าน|reset password/i,
  }).click();
  expect((await resetPasswordResponse).status()).toBe(200);

  await row.getByRole("button", { name: /ปิดการใช้งาน|disable user/i }).click();
  const deactivateResponse = page.waitForResponse(
    (response) => response.url().endsWith("/activation"),
  );
  await page.getByRole("dialog").getByRole("button", {
    name: /ปิดการใช้งาน|disable user/i,
  }).click();
  expect((await deactivateResponse).status()).toBe(200);
  await expect(row.locator("td").nth(7)).toContainText(/ปิดการใช้งาน|inactive/i);

  await page.context().clearCookies();
  await page.goto("/login");
  await page.locator("#identifier").fill(username);
  await page.locator("#password").fill(resetPassword);
  const disabledLogin = page.waitForResponse(
    (response) => response.url().endsWith("/api/auth/login"),
  );
  await page.getByRole("button", { name: /เข้าสู่ระบบ|sign in/i }).click();
  expect((await disabledLogin).status()).toBe(403);

  await switchUser(page, credentials.admin);
  await page.goto("/admin/users");
  const disabledRow = page.locator("table tbody tr").filter({ hasText: email });
  await disabledRow.getByRole("button", { name: /เปิดการใช้งาน|enable user/i }).click();
  const activateResponse = page.waitForResponse(
    (response) => response.url().endsWith("/activation"),
  );
  await page.getByRole("dialog").getByRole("button", {
    name: /เปิดการใช้งาน|enable user/i,
  }).click();
  expect((await activateResponse).status()).toBe(200);
  await expect(disabledRow.locator("td").nth(7)).toContainText(
    /ใช้งานอยู่|active/i,
  );

  await switchUser(page, { identifier: username, password: resetPassword });
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("reports apply filters and export Excel and PDF", async ({ page }) => {
  await signIn(page);
  const marker = uniqueValue("E2E-REPORT");
  await createRequestViaApi(page, {
    reason: `Report purchase request ${marker}`,
  });

  await page.goto(`/reports?query=${encodeURIComponent(marker)}`);
  const totalCard = page.locator('[data-slot="card"]').filter({
    hasText: /จำนวนเอกสาร|total documents/i,
  }).first();
  await expect(totalCard.getByText("1", { exact: true })).toBeVisible();

  const query = `query=${encodeURIComponent(marker)}`;
  const excel = await page.request.get(`/api/reports/export/excel?${query}`);
  expect(excel.status()).toBe(200);
  expect(excel.headers()["content-type"]).toContain(
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  expect((await excel.body()).byteLength).toBeGreaterThan(1000);

  const pdf = await page.request.get(`/api/reports/export/pdf?${query}`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).byteLength).toBeGreaterThan(1000);
});

test("user can change password only after providing the current password", async ({
  page,
}) => {
  const updatedPassword = "NewPassw0rd!";
  await signIn(page, credentials.employee2);
  await page.goto("/profile");

  await page.locator("#currentPassword").fill("IncorrectPassw0rd!");
  await page.locator("#newPassword").fill(updatedPassword);
  await page.locator("#confirmPassword").fill(updatedPassword);
  const rejectedChange = page.waitForResponse(
    (response) => response.url().endsWith("/api/users/me/password"),
  );
  await page.getByRole("button", {
    name: /บันทึกรหัสผ่านใหม่|save new password/i,
  }).click();
  expect((await rejectedChange).status()).toBe(400);

  await page.locator("#currentPassword").fill(credentials.employee2.password);
  const acceptedChange = page.waitForResponse(
    (response) => response.url().endsWith("/api/users/me/password"),
  );
  await page.getByRole("button", {
    name: /บันทึกรหัสผ่านใหม่|save new password/i,
  }).click();
  expect((await acceptedChange).status()).toBe(200);

  await signOut(page);
  await signIn(page, {
    identifier: credentials.employee2.identifier,
    password: updatedPassword,
  });
});

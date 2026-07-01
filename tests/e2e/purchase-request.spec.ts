import { expect, test, type Page } from "@playwright/test";

const employeeCredentials = {
  identifier: "somchai",
  password: "Passw0rd!",
};

const approverCredentials = {
  identifier: "0811111112",
  password: "Passw0rd!",
};

const profileCredentials = {
  identifier: "orathai",
  password: "Passw0rd!",
};

async function signIn(
  page: Page,
  credentials = employeeCredentials,
) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await page.locator("#identifier").fill(credentials.identifier);
  await page.locator("#password").fill(credentials.password);
  await page
    .getByRole("button", { name: /เข้าสู่ระบบ|sign in/i })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function signOut(page: Page) {
  await page
    .getByRole("button", { name: /ออกจากระบบ|sign out/i })
    .click();
  await expect(page).toHaveURL(/\/login$/);
}

async function createPurchaseRequest(page: Page, submit: boolean) {
  const timestamp = Date.now();
  const reason = `E2E purchase request ${timestamp}`;
  const itemName = `E2E item ${timestamp}`;

  await page.goto("/purchase-requests/new");
  await expect(page).toHaveURL(/\/purchase-requests\/new$/);

  await page.locator("#reason").fill(reason);
  await page.locator('input[name="items.0.itemName"]').fill(itemName);
  await page.locator('input[name="items.0.unitPrice"]').fill("1250");
  await page
    .locator('input[name="items.0.supplierName"]')
    .fill("E2E Supplier");

  const submitButton = submit
    ? page.getByRole("button", { name: /บันทึกและส่งอนุมัติ|save and submit/i })
    : page.getByRole("button", { name: /บันทึกร่าง|save draft/i });

  await submitButton.click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/^PR-/, {
    timeout: 15_000,
  });

  return { reason, itemName, url: page.url() };
}

test("redirects guests to the login page", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("#identifier")).toHaveValue("employee@demo.local");
});

test("employee can create a draft purchase request", async ({ page }) => {
  await signIn(page);

  const request = await createPurchaseRequest(page, false);
  const main = page.locator("main");

  await expect(page.getByText("Draft")).toBeVisible();
  await expect(main).toContainText(request.reason);
  await expect(main).toContainText(request.itemName);
  await expect(
    page.getByRole("button", { name: /ส่งอนุมัติ|submit for approval/i }),
  ).toBeVisible();
});

test("approver can approve a submitted purchase request", async ({ page }) => {
  await signIn(page);

  const request = await createPurchaseRequest(page, true);
  const main = page.locator("main");

  await expect(main).toContainText(/รออนุมัติ|pending approval/i);
  await expect(main).toContainText(request.reason);

  await signOut(page);
  await signIn(page, approverCredentials);

  await page.goto(request.url);
  await expect(main).toContainText(request.reason);

  await page.locator("#approval-comment").fill("Approved by E2E");
  await page.getByRole("button", { name: /อนุมัติ|approve/i }).click();

  await expect(main).toContainText(/อนุมัติแล้ว|approved/i);
  await expect(main).toContainText("Approved by E2E");
});

test("user can change their own password from the profile page", async ({ page }) => {
  const updatedPassword = "NewPassw0rd!";

  await signIn(page, profileCredentials);
  await page.goto("/profile");

  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    /โปรไฟล์ผู้ใช้งาน|user profile/i,
  );
  await page.locator("#currentPassword").fill(profileCredentials.password);
  await page.locator("#newPassword").fill(updatedPassword);
  await page.locator("#confirmPassword").fill(updatedPassword);
  await page
    .getByRole("button", { name: /บันทึกรหัสผ่านใหม่|save new password/i })
    .click();

  await signOut(page);
  await signIn(page, {
    identifier: profileCredentials.identifier,
    password: updatedPassword,
  });
  await expect(page).toHaveURL(/\/dashboard$/);
});

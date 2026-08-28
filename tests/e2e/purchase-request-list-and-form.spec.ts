import { Buffer } from "node:buffer";

import { expect, test } from "@playwright/test";

import {
  createRequestViaApi,
  credentials,
  signIn,
  statusText,
  switchUser,
  uniqueValue,
} from "./support";

test("purchase request form shows required-field validation", async ({ page }) => {
  await signIn(page);
  await page.goto("/purchase-requests/new");

  await page.getByRole("button", { name: /บันทึกร่าง|save draft/i }).click();

  await expect(page.getByText(/กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร|at least 10/i)).toBeVisible();
  await expect(page.getByText(/กรุณาระบุชื่อสินค้า|product name/i)).toBeVisible();
  await expect(page).toHaveURL(/\/purchase-requests\/new$/);
});

test("employee can create, upload, edit, and submit a draft", async ({ page }) => {
  await signIn(page);
  const marker = uniqueValue("E2E-FORM");
  const attachmentName = `${marker}.txt`;

  await page.goto("/purchase-requests/new");
  await page.locator("#reason").fill(`Purchase request for ${marker}`);
  await page.locator('input[name="items.0.itemName"]').fill(`Primary ${marker}`);
  await page.locator('input[name="items.0.unitPrice"]').fill("1000");
  await page.getByRole("button", { name: /เพิ่มรายการ|add item/i }).click();
  await page.locator('input[name="items.1.itemName"]').fill(`Secondary ${marker}`);
  await page.locator('input[name="items.1.quantity"]').fill("2");
  await page.locator('input[name="items.1.unitPrice"]').fill("250");
  await page.locator("#attachments").setInputFiles({
    name: attachmentName,
    mimeType: "text/plain",
    buffer: Buffer.from(`Attachment for ${marker}`),
  });

  await page.getByRole("button", { name: /บันทึกร่าง|save draft/i }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/^PR-/);
  await expect(page.locator("main")).toContainText(attachmentName);
  await expect(page.locator("main")).toContainText(`Secondary ${marker}`);
  await expect(page.locator("main")).toContainText(statusText.draft);

  const downloadHref = await page
    .locator('a[href*="/attachments/"]')
    .first()
    .getAttribute("href");
  expect(downloadHref).toBeTruthy();
  const downloadResponse = await page.request.get(downloadHref!);
  expect(downloadResponse.status()).toBe(200);
  expect(downloadResponse.headers()["content-disposition"]).toContain(attachmentName);

  await page.locator('a[href$="/edit"]').first().click();
  await page.locator("#reason").fill(`Updated purchase request for ${marker}`);
  await page.locator('input[name="items.0.itemName"]').fill(`Updated ${marker}`);
  await page.getByRole("button", {
    name: /บันทึกและส่งอนุมัติ|save and submit/i,
  }).click();

  await expect(page.locator("main")).toContainText(`Updated ${marker}`);
  await expect(page.locator("main")).toContainText(statusText.pending);
});

test("list searches item name, item description, and supplier", async ({ page }) => {
  await signIn(page);

  for (const query of ["Wireless Mouse", "อุปกรณ์ประกอบการใช้งาน", "OfficeMate"]) {
    await page.goto(`/purchase-requests?query=${encodeURIComponent(query)}`);
    await expect(
      page.locator("table tbody tr").filter({ hasText: "PR-202606-0001" }),
    ).toHaveCount(1);
  }
});

test("list applies status, urgency, sort, and clear filters", async ({ page }) => {
  await signIn(page);
  const marker = uniqueValue("E2E-FILTER");
  const request = await createRequestViaApi(page, {
    reason: `Filtered purchase request ${marker}`,
    urgency: "HIGH",
  });

  await page.goto("/purchase-requests");
  await page.locator("#query").fill(marker);
  await page.locator("#status").selectOption("DRAFT");
  await page.locator("#urgency").selectOption("HIGH");
  await page.locator("#sort").selectOption("pr_asc");
  await page.getByRole("button", { name: /ค้นหา|search/i }).click();

  await expect(page).toHaveURL(/query=.*E2E-FILTER/);
  await expect(page).toHaveURL(/status=DRAFT/);
  await expect(page).toHaveURL(/urgency=HIGH/);
  await expect(page.locator("table tbody tr")).toHaveCount(1);
  await expect(page.locator("table tbody tr")).toContainText(request.prNumber);

  await page.getByRole("link", { name: /ล้างตัวกรอง|clear filters/i }).click();
  await expect(page).toHaveURL(/\/purchase-requests$/);
});

test("list paginates filtered results at ten rows per page", async ({ page }) => {
  await signIn(page);
  const marker = uniqueValue("E2E-PAGE");

  for (let index = 1; index <= 11; index += 1) {
    await createRequestViaApi(page, {
      reason: `${marker} purchase request number ${index}`,
      itemName: `${marker} product ${index}`,
    });
  }

  await page.goto(`/purchase-requests?query=${encodeURIComponent(marker)}`);
  await expect(page.locator("table tbody tr")).toHaveCount(10);
  await expect(page.locator("main")).toContainText(/หน้า 1 จาก 2|Page 1 of 2/);

  const pagination = page.locator("nav").filter({
    has: page.locator('a[href*="page=2"]'),
  });
  await pagination.getByRole("link", {
    name: /Purchase Request: 2$/,
  }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page).toHaveURL(new RegExp(`query=${marker}`));
  await expect(page.locator("table tbody tr")).toHaveCount(1);
  await expect(page.locator("main")).toContainText(/หน้า 2 จาก 2|Page 2 of 2/);
});

test("employee visibility is scoped while assigned approver can view the request", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/purchase-requests?query=Safety%20Helmet");
  await expect(page.locator("main")).toContainText(
    /ยังไม่พบรายการเอกสาร|no documents match/i,
  );

  await switchUser(page, credentials.approver);
  await page.goto("/purchase-requests?query=Safety%20Helmet");
  await expect(
    page.locator("table tbody tr").filter({ hasText: "PR-202606-0002" }),
  ).toHaveCount(1);
});

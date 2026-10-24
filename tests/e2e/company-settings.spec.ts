import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

import { authenticate, expectStatus, getRequest } from "./receipt-support";
import { credentials, uniqueValue } from "./support";

type CompanyDetails = {
  name: string;
  address: string;
  taxId: string | null;
  branch: string | null;
  phone: string | null;
  email: string | null;
};

type CompanyProfile = CompanyDetails & { version: number; updatedAt: string };
type IssuedOrder = { id: string; poNumber: string; buyerCompany: CompanyDetails | null };

const companyEndpoint = "/api/admin/company";
const saveName = /บันทึกข้อมูลบริษัท|save company details/i;

async function getCompany(page: Page) {
  const response = await page.request.get(companyEndpoint);
  await expectStatus(response, 200);
  return await response.json() as CompanyProfile | null;
}

async function getOrder(page: Page, id: string) {
  const response = await page.request.get(`/api/purchase-orders/${id}`);
  await expectStatus(response, 200);
  return await response.json() as IssuedOrder;
}

async function issueOrders(page: Page) {
  await authenticate(page);
  const marker = uniqueValue("E2E-company");
  const created = await page.request.post("/api/purchase-requests", {
    multipart: {
      payload: JSON.stringify({
        requestDate: "2026-10-24",
        department: "Operations",
        reason: `Verify buyer company snapshots ${marker}`,
        urgency: "NORMAL",
        submit: true,
        items: ["Alpha", "Beta"].map((supplier, index) => ({
          itemName: `${marker} item ${index + 1}`,
          supplierName: `${supplier} Company Test Supplier`,
          quantity: 2,
          unit: "ชิ้น",
          unitPrice: 100,
          amount: 200,
        })),
      }),
    },
  });
  await expectStatus(created, 200);
  const { id } = await created.json() as { id: string };
  await authenticate(page, credentials.approver);
  await expectStatus(await page.request.post(`/api/purchase-requests/${id}/approval`, {
    data: { action: "APPROVED", comment: "Approved company snapshot test purchase" },
  }), 200);
  await authenticate(page, credentials.purchasing);
  const request = await getRequest(page, id);
  const converted = await page.request.post(`/api/purchase-requests/${id}/purchase-orders`, {
    data: {
      orders: request.items.map((item) => ({
        supplierName: item.supplierName,
        itemIds: [item.id],
      })),
    },
  });
  await expectStatus(converted, 201);
  const { purchaseOrders } = await converted.json() as { purchaseOrders: Array<{ id: string }> };
  expect(purchaseOrders).toHaveLength(2);
  return Promise.all(purchaseOrders.map((order) => getOrder(page, order.id)));
}

async function fillCompany(page: Page, details: CompanyDetails) {
  for (const [field, value] of Object.entries(details)) {
    const id = field === "taxId" ? "tax-id" : field;
    await page.locator(`#company-${id}`).fill(value ?? "");
  }
}

async function saveCompany(page: Page) {
  const saved = page.waitForResponse((response) =>
    response.url().endsWith(companyEndpoint) && response.request().method() === "PUT",
  );
  await page.getByRole("button", { name: saveName }).click();
  return saved;
}

test("admin configures the buyer company, backfills legacy POs and preserves issued snapshots through later edits", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await authenticate(page, credentials.admin);
  expect(await getCompany(page)).toBeNull();
  const legacyOrders = await issueOrders(page);
  for (const order of legacyOrders) expect(order.buyerCompany).toBeNull();

  await authenticate(page, credentials.admin);
  await page.goto("/dashboard");
  const menu = page.locator('header a[href="/admin/company"]:visible');
  await expect(menu).toHaveCount(1);
  await menu.click();
  await expect(page).toHaveURL(/\/admin\/company$/);
  let attemptedSaves = 0;
  page.on("request", (request) => {
    if (request.url().endsWith(companyEndpoint) && request.method() === "PUT") attemptedSaves += 1;
  });
  await page.getByRole("button", { name: saveName }).click();
  await expect(page.locator("#company-name-error")).toBeVisible();
  await expect(page.locator("#company-address-error")).toBeVisible();
  expect(attemptedSaves).toBe(0);

  for (const data of [
    { expectedVersion: 0, name: "", address: "123 Buyer Road" },
    { expectedVersion: 0, name: "Company", address: "   " },
    { expectedVersion: 0, name: "Company", address: "123 Buyer Road", email: "invalid-email" },
    { expectedVersion: -1, name: "Company", address: "123 Buyer Road" },
  ]) {
    await expectStatus(await page.request.put(companyEndpoint, { data }), 400);
  }
  expect(await getCompany(page)).toBeNull();
  const first: CompanyDetails = {
    name: `Buyer ${uniqueValue("original")}`,
    address: "123 Buyer Road, Bangkok 10110",
    taxId: "0105551234567",
    branch: "สำนักงานใหญ่",
    phone: "02-123-4567",
    email: "purchasing@example.test",
  };
  await fillCompany(page, Object.fromEntries(
    Object.entries(first).map(([field, value]) => [field, `  ${value}  `]),
  ) as CompanyDetails);
  const initialSave = await saveCompany(page);
  expect(initialSave.status()).toBe(200);
  expect(await initialSave.json()).toMatchObject({ ...first, version: 1 });
  const initialProfile = await getCompany(page);
  expect(initialProfile).toMatchObject({ ...first, version: 1 });
  expect(Number.isNaN(Date.parse(initialProfile!.updatedAt))).toBe(false);
  await expect(page.locator("#company-name")).toHaveValue(first.name);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("company-settings-desktop.png"), fullPage: true });
  const originalViewport = page.viewportSize();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("company-settings-mobile.png"), fullPage: true });
  if (originalViewport) await page.setViewportSize(originalViewport);
  for (const order of legacyOrders) {
    expect((await getOrder(page, order.id)).buyerCompany).toMatchObject(first);
  }

  // Another admin's update must not silently replace this form's draft.
  const second: CompanyDetails = {
    name: `Buyer ${uniqueValue("second")}`,
    address: "456 Updated Buyer Road, Bangkok 10220",
    taxId: null,
    branch: null,
    phone: null,
    email: null,
  };
  await expectStatus(await page.request.put(companyEndpoint, {
    data: { ...second, taxId: "  ", phone: "", expectedVersion: 1 },
  }), 200);
  expect(await getCompany(page)).toMatchObject({ ...second, version: 2 });
  const unsavedName = "Keep this unsaved administrator draft";
  await page.locator("#company-name").fill(unsavedName);
  const conflict = await saveCompany(page);
  expect(conflict.status()).toBe(409);
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await expect(page.locator("#company-name")).toHaveValue(unsavedName);
  await expect(page.locator("#company-address")).toHaveValue(first.address);
  expect(await getCompany(page)).toMatchObject({ ...second, version: 2 });
  const reloaded = page.waitForResponse((response) =>
    response.url().endsWith(companyEndpoint) && response.request().method() === "GET",
  );
  await page.locator("#reload-company-profile").click();
  expect((await reloaded).status()).toBe(200);
  await expect(page.locator("#company-name")).toHaveValue(second.name);
  await expect(page.locator("#company-address")).toHaveValue(second.address);
  for (const field of ["tax-id", "branch", "phone", "email"]) {
    await expect(page.locator(`#company-${field}`)).toHaveValue("");
  }
  const latest: CompanyDetails = {
    ...first,
    name: `Buyer ${uniqueValue("latest")}`,
    address: "789 Latest Buyer Road, Bangkok 10330",
    email: "latest-buyer@example.test",
  };
  await fillCompany(page, latest);
  const finalSave = await saveCompany(page);
  expect(finalSave.status()).toBe(200);
  expect(await finalSave.json()).toMatchObject({ ...latest, version: 3 });
  const newOrders = await issueOrders(page);
  for (const order of newOrders) expect(order.buyerCompany).toMatchObject(latest);
  for (const order of legacyOrders) {
    expect((await getOrder(page, order.id)).buyerCompany).toMatchObject(first);
  }

  // Preview, printing and the PDF download all render the persisted PO identity.
  for (const [order, buyer] of [[legacyOrders[0]!, first], [newOrders[0]!, latest]] as const) {
    await page.goto(`/purchase-orders/${order.id}`);
    const document = page.locator(".purchase-order-document");
    const text = (await document.locator("svg text").allTextContents()).join(" ").replace(/\s+/g, " ");
    for (const value of Object.values(buyer)) if (value) expect(text).toContain(value);
    const otherName = buyer === first ? latest.name : first.name;
    expect(text).not.toContain(otherName);
    if (buyer === first) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      await page.screenshot({ path: testInfo.outputPath("company-po-preview.png"), fullPage: true });
    }
    await page.emulateMedia({ media: "print" });
    await expect(document).toBeVisible();
    await expect(document).toContainText(buyer.name);
    await expect(page.getByRole("banner")).toBeHidden();
    const response = await page.request.get(`/api/purchase-orders/${order.id}/pdf`);
    await expectStatus(response, 200);
    expect(response.headers()["content-type"]).toContain("application/pdf");
    expect(response.headers()["content-disposition"]).toContain(`${order.poNumber}.pdf`);
    const pdf = await PDFDocument.load(await response.body());
    expect(pdf.getTitle()).toContain(order.poNumber);
    expect(pdf.getPageCount()).toBe(await document.locator("svg.purchase-order-page").count());
    for (const pdfPage of pdf.getPages()) {
      expect(pdfPage.getWidth()).toBeCloseTo(595.28, 1);
      expect(pdfPage.getHeight()).toBeCloseTo(841.89, 1);
    }
    await page.emulateMedia({ media: "screen" });
  }
});

test("only admins see the company menu and can open the settings page or read and update its API", async ({ page }) => {
  test.setTimeout(90_000);
  await authenticate(page, credentials.admin);
  const original = await getCompany(page);
  const payload = {
    name: "Unauthorized replacement company",
    address: "Unauthorized replacement address",
    expectedVersion: original?.version ?? 0,
  };
  for (const account of [credentials.employee, credentials.approver, credentials.purchasing, credentials.management]) {
    await authenticate(page, account);
    await page.goto("/dashboard");
    await expect(page.locator('a[href="/admin/company"]')).toHaveCount(0);
    await page.goto("/admin/company");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator("#company-name")).toHaveCount(0);
    await expectStatus(await page.request.get(companyEndpoint), 403);
    await expectStatus(await page.request.put(companyEndpoint, { data: payload }), 403);
  }
  await page.context().clearCookies();
  await expectStatus(await page.request.get(companyEndpoint), 401);
  await expectStatus(await page.request.put(companyEndpoint, { data: payload }), 401);
  await page.goto("/admin/company");
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
  await authenticate(page, credentials.admin);
  expect(await getCompany(page)).toEqual(original);
});

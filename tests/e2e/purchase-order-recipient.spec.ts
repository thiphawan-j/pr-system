import { expect, test, type Locator, type Page } from "@playwright/test";

import type { AdminUserItem, PurchaseOrderDetail, PurchaseOrderSummary, PurchaseRequestDetail } from "../../src/lib/types";
import { authenticate, expectStatus, getRequest } from "./receipt-support";
import { createRequestViaApi, credentials, uniqueValue, type Credentials } from "./support";

async function approvedRequest(page: Page, account: Credentials = credentials.employee) {
  await authenticate(page, account);
  const created = await createRequestViaApi(page, {
    submit: true,
    department: account === credentials.employee2 ? "Projects" : "Operations",
  });
  await authenticate(page, credentials.admin);
  await expectStatus(await page.request.post(`/api/purchase-requests/${created.id}/approval`, {
    data: { action: "APPROVED", comment: "Approve source for delivery recipient testing" },
  }), 200);
  await authenticate(page, credentials.purchasing);
  return getRequest(page, created.id);
}

async function users(page: Page) {
  await authenticate(page, credentials.admin);
  const response = await page.request.get("/api/admin/users?limit=100");
  await expectStatus(response, 200);
  return (await response.json() as { items: AdminUserItem[] }).items;
}

async function getOrder(page: Page, id: string) {
  const response = await page.request.get(`/api/purchase-orders/${id}`);
  await expectStatus(response, 200);
  return await response.json() as PurchaseOrderDetail;
}

async function issue(page: Page, source: PurchaseRequestDetail, deliveryRecipientId?: string) {
  const response = await page.request.post(`/api/purchase-requests/${source.id}/purchase-orders`, {
    data: { orders: [{ supplierName: "Recipient test supplier", itemIds: source.items.map((item) => item.id),
      ...(deliveryRecipientId ? { deliveryRecipientId } : {}),
    }] },
  });
  await expectStatus(response, 201);
  const { purchaseOrders } = await response.json() as { purchaseOrders: PurchaseOrderSummary[] };
  return getOrder(page, purchaseOrders[0]!.id);
}

function changePayload(order: PurchaseOrderDetail, deliveryRecipientId: string) {
  return {
    expectedVersion: order.version, reason: "Change the employee responsible for receiving this order",
    supplier: { supplierName: order.supplierName }, deliveryRecipientId,
    deliveryAddress: order.deliveryAddress ?? "", paymentTerms: order.paymentTerms ?? "",
    items: order.items.map((item) => ({ id: item.id, itemName: item.itemName,
      quantity: item.quantity, unit: item.unit ?? "", unitPrice: item.unitPrice,
    })),
  };
}

async function reveal(page: Page, field: Locator) {
  if (!await field.isVisible()) {
    await page.locator("details").filter({ has: field }).last().locator("summary").first().click();
  }
  await expect(field).toBeVisible();
}

async function freshRecipient(page: Page) {
  await authenticate(page, credentials.admin);
  const marker = uniqueValue("r").replaceAll("-", "");
  const response = await page.request.post("/api/admin/users", { data: {
    employeeCode: marker, username: marker, email: `${marker}@recipient.test`,
    phone: `08${marker.slice(-8)}`, name: `Recipient ${marker}`, department: "IT",
    role: "EMPLOYEE", password: "Passw0rd!",
  } });
  await expectStatus(response, 201);
  return (await response.json() as { user: AdminUserItem }).user;
}

test("recipient dropdown includes every active non-admin employee, defaults to the requester and persists another department's selection", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const source = await approvedRequest(page);
  const directory = await users(page);
  const another = directory.find((user) => user.username === credentials.employee2.identifier)!;
  await authenticate(page, credentials.purchasing);
  await page.goto(`/purchase-requests/${source.id}/purchase-orders/new`);
  const select = page.locator("#po-delivery-recipient-0");
  await reveal(page, select);
  await expect(select).toHaveValue(source.requester.id);
  const optionIds = await select.locator("option").evaluateAll((options: HTMLOptionElement[]) => options.map((option) => option.value).filter(Boolean));
  expect(optionIds.sort()).toEqual(directory.filter((user) => user.isActive && user.role !== "ADMIN").map((user) => user.id).sort());
  await select.selectOption(another.id);
  await page.setViewportSize({ width: 375, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await select.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("recipient-mobile.png") });
  const conversion = page.waitForResponse((response) => response.request().method() === "POST"
    && response.url().endsWith(`/api/purchase-requests/${source.id}/purchase-orders`));
  await page.locator("#create-purchase-orders").click();
  await page.locator("#confirm-create-purchase-orders").click();
  const response = await conversion;
  await expectStatus(response, 201);
  const result = await response.json() as { purchaseOrders: PurchaseOrderSummary[] };
  const order = await getOrder(page, result.purchaseOrders[0]!.id);
  expect(order).toMatchObject({ deliveryRecipientId: another.id, deliveryRecipientName: another.name, deliveryRecipientPhone: another.phone });
  await page.goto(`/purchase-orders/${order.id}`);
  await expect(page.locator(".purchase-order-document")).toContainText(another.name);
  await page.goto(`/purchase-orders/${order.id}/edit`);
  const editSelect = page.locator("#po-edit-delivery-recipient");
  await reveal(page, editSelect);
  await expect(editSelect).toHaveValue(another.id);
});

test("combined PO groups default to their actual source PR requester when the recipient is omitted", async ({ page }) => {
  test.setTimeout(60_000);
  const a = await approvedRequest(page);
  const b = await approvedRequest(page, credentials.employee2);
  const response = await page.request.post("/api/purchase-orders", { data: {
    requests: [b, a].map((source) => ({ id: source.id, expectedUpdatedAt: source.orderPreparationVersion ?? source.updatedAt })),
    orders: [
      { supplierName: "First source recipient", itemIds: a.items.map((item) => item.id) },
      { supplierName: "Second source recipient", itemIds: b.items.map((item) => item.id) },
    ],
  } });
  await expectStatus(response, 201);
  const { purchaseOrders } = await response.json() as { purchaseOrders: PurchaseOrderSummary[] };
  expect(purchaseOrders).toHaveLength(2);
  for (const summary of purchaseOrders) {
    const order = await getOrder(page, summary.id);
    const source = order.supplierName === "First source recipient" ? a : b;
    expect(order).toMatchObject({ deliveryRecipientId: source.requester.id, deliveryRecipientName: source.requester.name });
    expect(order.items.every((item) => item.sourcePurchaseRequestId === source.id)).toBe(true);
  }
});

test("create and amendment APIs reject admin, inactive and unknown recipients without changing the source or issued order", async ({ page }) => {
  test.setTimeout(60_000);
  const inactive = await freshRecipient(page);
  await expectStatus(await page.request.post(`/api/admin/users/${inactive.id}/activation`, { data: { isActive: false } }), 200);
  const admin = (await users(page)).find((user) => user.username === credentials.admin.identifier)!;
  const source = await approvedRequest(page);
  const invalidIds = [admin.id, inactive.id, "not-an-existing-recipient"];
  for (const deliveryRecipientId of invalidIds) {
    await expectStatus(await page.request.post(`/api/purchase-requests/${source.id}/purchase-orders`, {
      data: { orders: [{ supplierName: "Invalid recipient", itemIds: source.items.map((item) => item.id), deliveryRecipientId }] },
    }), 400);
    expect(await getRequest(page, source.id)).toEqual(source);
  }
  const order = await issue(page, source);
  for (const deliveryRecipientId of invalidIds) {
    await expectStatus(await page.request.patch(`/api/purchase-orders/${order.id}`, { data: changePayload(order, deliveryRecipientId) }), 400);
    expect(await getOrder(page, order.id)).toEqual(order);
  }
});

test("recipient edits await approval, appear in Timeline and retain the issued name after employee changes", async ({ page }) => {
  test.setTimeout(60_000);
  const recipient = await freshRecipient(page);
  const source = await approvedRequest(page);
  const original = await issue(page, source);
  await page.goto(`/purchase-orders/${original.id}/edit`);
  const select = page.locator("#po-edit-delivery-recipient");
  await reveal(page, select);
  await expect(select).toHaveValue(source.requester.id);
  await select.selectOption(recipient.id);
  await page.locator("#po-edit-reason").fill("Assign a different employee to receive the supplier delivery");
  const proposal = page.waitForResponse((response) => response.request().method() === "PATCH"
    && response.url().endsWith(`/api/purchase-orders/${original.id}`));
  await page.locator("#save-po-changes").click();
  await expectStatus(await proposal, 200);
  await expect(page).toHaveURL(new RegExp(`/purchase-orders/${original.id}$`));
  const pending = await getOrder(page, original.id);
  expect(pending.deliveryRecipientId).toBe(original.deliveryRecipientId);
  const change = pending.changes.find((entry) => entry.id === pending.pendingChangeId)!;
  expect(change.before).toMatchObject({ deliveryRecipientId: source.requester.id, deliveryRecipientName: source.requester.name });
  expect(change.after).toMatchObject({ deliveryRecipientId: recipient.id, deliveryRecipientName: recipient.name, deliveryRecipientPhone: recipient.phone });
  await authenticate(page, credentials.admin);
  await expectStatus(await page.request.post(`/api/purchase-orders/${original.id}/changes/${pending.pendingChangeId}/review`, {
    data: { expectedVersion: pending.version, action: "APPROVED", comment: "Approved the new delivery recipient" },
  }), 200);
  const approved = await getOrder(page, original.id);
  expect(approved).toMatchObject({ deliveryRecipientId: recipient.id, deliveryRecipientName: recipient.name, deliveryRecipientPhone: recipient.phone });
  const timeline = (await getRequest(page, source.id)).approvals.map((entry) => entry.comment ?? "").join("\n");
  expect(timeline).toContain("ผู้รับสินค้า");
  expect(timeline).toContain(source.requester.name);
  expect(timeline).toContain(recipient.name);
  await expectStatus(await page.request.patch(`/api/admin/users/${recipient.id}`, { data: {
    ...recipient, title: recipient.title ?? undefined, name: `${recipient.name} renamed`, phone: `09${recipient.phone!.slice(-8)}`,
  } }), 200);
  await expectStatus(await page.request.post(`/api/admin/users/${recipient.id}/activation`, { data: { isActive: false } }), 200);
  expect(await getOrder(page, original.id)).toMatchObject({
    deliveryRecipientId: recipient.id, deliveryRecipientName: recipient.name, deliveryRecipientPhone: recipient.phone,
  });
  await authenticate(page, credentials.purchasing);
  await page.goto(`/purchase-orders/${original.id}`);
  await expect(page.locator(".purchase-order-document")).toContainText(recipient.name);
  await page.goto(`/purchase-orders/${original.id}/edit`);
  const saved = page.locator("#po-edit-delivery-recipient");
  await reveal(page, saved);
  await expect(saved).toHaveValue(recipient.id);
  await expect(saved.locator(`option[value="${recipient.id}"]`)).toHaveText(new RegExp(recipient.name));
});

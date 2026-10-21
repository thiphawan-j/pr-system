import { expect, test, type APIResponse, type Page } from "@playwright/test";

import type { PurchaseOrderDetail, PurchaseOrderSummary, PurchaseRequestDetail, SupplierContact, SupplierDetail, SupplierListPage } from "../../src/lib/types";
import { authenticate, expectStatus, getRequest } from "./receipt-support";
import { credentials, uniqueValue } from "./support";

type SupplierInput = {
  name: string;
  taxId?: string;
  address?: string;
  contactPerson?: string;
  paymentTerms?: string;
  note?: string;
  contacts: SupplierContact[];
};

function supplierInput(changes: Partial<SupplierInput> = {}): SupplierInput {
  const marker = uniqueValue("E2E-SUP");
  return {
    name: `Supplier ${marker}`,
    taxId: uniqueValue("TAX"),
    address: "123 Supplier Road",
    contactPerson: `Contact ${marker}`,
    paymentTerms: "Net 30 days",
    note: "Preferred supplier for approved maintenance purchases",
    contacts: [
      { channel: "LINE", value: `@line-${marker}` },
      { channel: "PHONE", value: "0812345678" },
      { channel: "ECOMMERCE", value: `https://shop.example.test/${marker}` },
    ],
    ...changes,
  };
}

function contactsOf(contacts: SupplierContact[]) {
  return contacts.map(({ channel, value }) => ({ channel, value })).sort((left, right) => left.channel.localeCompare(right.channel));
}

async function createSupplier(page: Page, changes: Partial<SupplierInput> = {}) {
  const response = await page.request.post("/api/suppliers", { data: supplierInput(changes) });
  await expectStatus(response, 201);
  return await response.json() as SupplierDetail;
}

async function getSupplier(page: Page, id: string) {
  const response = await page.request.get(`/api/suppliers/${id}`);
  await expectStatus(response, 200);
  return await response.json() as SupplierDetail;
}

async function listSuppliers(page: Page, query: string, extra: Record<string, string | number> = {}) {
  const response = await page.request.get("/api/suppliers", { params: { query, ...extra } });
  await expectStatus(response, 200);
  return await response.json() as SupplierListPage;
}

function updateSupplier(page: Page, supplier: SupplierDetail, changes: Partial<SupplierInput> & { isActive?: boolean } = {}, expectedVersion = supplier.version) {
  return page.request.patch(`/api/suppliers/${supplier.id}`, { data: {
    name: supplier.name,
    taxId: supplier.taxId ?? "",
    address: supplier.address ?? "",
    contactPerson: supplier.contactPerson ?? "",
    paymentTerms: supplier.paymentTerms ?? "",
    note: supplier.note ?? "",
    contacts: contactsOf(supplier.contacts),
    isActive: supplier.isActive,
    ...changes,
    expectedVersion,
  } });
}

async function editedSupplier(response: APIResponse) {
  await expectStatus(response, 200);
  return await response.json() as SupplierDetail;
}

async function createApprovedRequest(page: Page) {
  await authenticate(page);
  const marker = uniqueValue("E2E-SUP-PR");
  const response = await page.request.post("/api/purchase-requests", {
    multipart: { payload: JSON.stringify({
      requestDate: "2026-10-21", department: "Operations", reason: `Approved source request ${marker}`, urgency: "NORMAL", submit: true,
      items: [
        { itemName: `${marker} first item`, supplierName: "PR supplier hint", quantity: 2, unit: "ชิ้น", unitPrice: 10.25, amount: 20.5 },
        { itemName: `${marker} second item`, supplierName: "Other PR supplier hint", quantity: 3, unit: "ชิ้น", unitPrice: 20, amount: 60 },
      ],
    }) },
  });
  await expectStatus(response, 200);
  const { id } = await response.json() as { id: string };
  await authenticate(page, credentials.approver);
  await expectStatus(await page.request.post(`/api/purchase-requests/${id}/approval`, {
    data: { action: "APPROVED", comment: "Approved for registered supplier PO tests" },
  }), 200);
  await authenticate(page, credentials.purchasing);
  return getRequest(page, id);
}

function issueRegistered(page: Page, request: PurchaseRequestDetail, supplierId: string) {
  return page.request.post(`/api/purchase-requests/${request.id}/purchase-orders`, {
    data: { orders: [{ supplierId, itemIds: request.items.map((item) => item.id) }] },
  });
}

async function issuedOrder(page: Page, response: Pick<APIResponse, "status" | "text" | "json">) {
  await expectStatus(response, 201);
  const { purchaseOrders } = await response.json() as { purchaseOrders: PurchaseOrderSummary[] };
  expect(purchaseOrders).toHaveLength(1);
  const detail = await page.request.get(`/api/purchase-orders/${purchaseOrders[0]!.id}`);
  await expectStatus(detail, 200);
  return await detail.json() as PurchaseOrderDetail;
}

function masterSnapshot(supplier: SupplierDetail) {
  return {
    supplierId: supplier.id,
    supplierCode: supplier.code,
    supplierName: supplier.name,
    supplierAddress: supplier.address,
    supplierTaxId: supplier.taxId,
    supplierContactPerson: supplier.contactPerson,
    supplierContacts: contactsOf(supplier.contacts),
    paymentTerms: supplier.paymentTerms,
  };
}

function orderSnapshot(order: PurchaseOrderDetail) {
  return {
    supplierId: order.supplierId,
    supplierCode: order.supplierCode,
    supplierName: order.supplierName,
    supplierAddress: order.supplierAddress,
    supplierTaxId: order.supplierTaxId,
    supplierContactPerson: order.supplierContactPerson,
    supplierContacts: contactsOf(order.supplierContacts),
    paymentTerms: order.paymentTerms,
  };
}

test("Purchasing persists all five contact channels and trims master fields without losing contact values", async ({ page }) => {
  await authenticate(page, credentials.purchasing);
  const maximumValue = "x".repeat(500);
  const supplier = await createSupplier(page, {
    name: `  ${uniqueValue("Supplier-five-channels")}  `,
    address: "  123 Supplier Road  ",
    contacts: [
      { channel: "LINE", value: "  @purchase-team  " },
      { channel: "PHONE", value: "  0812345678  " },
      { channel: "ECOMMERCE", value: "  https://shop.example.test/vendor  " },
      { channel: "EMAIL", value: "  sales@example.test  " },
      { channel: "OTHER", value: `  ${maximumValue}  ` },
    ],
  });
  expect(supplier.code).toMatch(/^SUP-\d{5,}$/);
  expect(supplier.name).toBe(supplier.name.trim());
  expect(supplier.address).toBe("123 Supplier Road");
  expect(supplier.isActive).toBe(true);
  expect(supplier.version).toBe(0);
  expect(contactsOf(supplier.contacts)).toEqual(contactsOf([
    { channel: "LINE", value: "@purchase-team" }, { channel: "PHONE", value: "0812345678" },
    { channel: "ECOMMERCE", value: "https://shop.example.test/vendor" }, { channel: "EMAIL", value: "sales@example.test" },
    { channel: "OTHER", value: maximumValue },
  ]));
  expect(await getSupplier(page, supplier.id)).toEqual(supplier);
});

test("editing atomically replaces contacts, clears optional fields and preserves the supplier identity", async ({ page }) => {
  await authenticate(page, credentials.admin);
  const original = await createSupplier(page);
  const edited = await editedSupplier(await updateSupplier(page, original, {
    name: `${original.name} revised`, taxId: "", address: "", contactPerson: "", paymentTerms: "", note: "",
    contacts: [{ channel: "EMAIL", value: "replacement@example.test" }],
  }));
  expect(edited).toMatchObject({
    id: original.id, code: original.code, createdAt: original.createdAt, version: original.version + 1,
    taxId: null, address: null, contactPerson: null, paymentTerms: null, note: null,
    contacts: [{ channel: "EMAIL", value: "replacement@example.test" }],
  });
  expect(await getSupplier(page, original.id)).toEqual(edited);
  await expectStatus(await page.request.delete(`/api/suppliers/${original.id}`), 405);
  expect(await getSupplier(page, original.id)).toEqual(edited);
});

test("supplier data and maintenance are restricted to Purchasing and Admin across APIs and navigation", async ({ page }) => {
  await authenticate(page, credentials.purchasing);
  const supplier = await createSupplier(page);
  for (const account of [credentials.employee, credentials.employee2, credentials.approver, credentials.management]) {
    await authenticate(page, account);
    await expectStatus(await page.request.get("/api/suppliers"), 403);
    await expectStatus(await page.request.get(`/api/suppliers/${supplier.id}`), 403);
    await expectStatus(await page.request.post("/api/suppliers", { data: supplierInput() }), 403);
    await expectStatus(await updateSupplier(page, supplier, { name: "Unauthorized rename" }), 403);
  }
  await page.context().clearCookies();
  await expectStatus(await page.request.get("/api/suppliers"), 401);
  await expectStatus(await page.request.get(`/api/suppliers/${supplier.id}`), 401);
  await expectStatus(await page.request.post("/api/suppliers", { data: supplierInput() }), 401);
  await expectStatus(await updateSupplier(page, supplier), 401);
  await authenticate(page);
  await page.goto("/dashboard");
  await expect(page.locator('header a[href="/suppliers"]')).toHaveCount(0);
  await page.goto("/suppliers");
  await expect(page).toHaveURL(/\/dashboard$/);
  await authenticate(page, credentials.purchasing);
  expect(await getSupplier(page, supplier.id)).toEqual(supplier);
});

test("concurrent supplier edits commit one complete contact set and stale replay cannot overwrite it", async ({ page }) => {
  await authenticate(page, credentials.purchasing);
  const supplier = await createSupplier(page);
  const alternatives: Partial<SupplierInput>[] = [
    { name: `${supplier.name} version A`, address: "Address A", contacts: [{ channel: "LINE", value: "@version-a" }] },
    { name: `${supplier.name} version B`, address: "Address B", contacts: [{ channel: "PHONE", value: "0899999999" }] },
  ];
  const results = await Promise.all(alternatives.map((change) => updateSupplier(page, supplier, change)));
  expect(results.map((response) => response.status()).sort()).toEqual([200, 409]);
  const current = await getSupplier(page, supplier.id);
  const winner = alternatives[results.findIndex((response) => response.status() === 200)]!;
  expect(current).toMatchObject({ ...winner, version: supplier.version + 1 });
  await expectStatus(await updateSupplier(page, supplier, alternatives[0]), 409);
  expect(await getSupplier(page, supplier.id)).toEqual(current);
});

test("deactivation and reactivation preserve the master while active filters and default ALL stay accurate", async ({ page }) => {
  await authenticate(page, credentials.purchasing);
  const supplier = await createSupplier(page);
  const inactive = await editedSupplier(await updateSupplier(page, supplier, { isActive: false }));
  expect((await listSuppliers(page, supplier.code)).items).toEqual([inactive]);
  expect((await listSuppliers(page, supplier.code, { status: "ACTIVE" })).items).toEqual([]);
  expect((await listSuppliers(page, supplier.code, { status: "INACTIVE" })).items).toEqual([inactive]);
  expect(inactive.contacts).toEqual(supplier.contacts);
  const active = await editedSupplier(await updateSupplier(page, inactive, { isActive: true }));
  expect(active.version).toBe(supplier.version + 2);
  expect(active.code).toBe(supplier.code);
  expect((await listSuppliers(page, supplier.code, { status: "ACTIVE" })).items).toEqual([active]);
  expect((await listSuppliers(page, supplier.code, { status: "INACTIVE" })).items).toEqual([]);
});

test("supplier searches find code, name, tax ID, contact person and channel values case insensitively", async ({ page }) => {
  await authenticate(page, credentials.purchasing);
  const supplier = await createSupplier(page);
  for (const query of [supplier.code, supplier.name, supplier.taxId!, supplier.contactPerson!, supplier.contacts.find((contact) => contact.channel === "LINE")!.value]) {
    const results = await listSuppliers(page, query.toUpperCase());
    expect(results.totalCount).toBe(1);
    expect(results.items.map((item) => item.id)).toEqual([supplier.id]);
  }
});

test("filtered supplier pagination returns every match once with consistent totals", async ({ page }) => {
  await authenticate(page, credentials.purchasing);
  const marker = uniqueValue("Supplier-paging");
  const suppliers: SupplierDetail[] = [];
  for (let index = 0; index < 5; index += 1) suppliers.push(await createSupplier(page, { name: `${marker} ${index}` }));
  const pages = await Promise.all([1, 2, 3].map((currentPage) => listSuppliers(page, marker, { page: currentPage, limit: 2 })));
  expect(pages.map((result) => result.items.length)).toEqual([2, 2, 1]);
  for (const result of pages) {
    expect(result.totalCount).toBe(5);
    expect(result.totalPages).toBe(3);
    expect(result.limit).toBe(2);
  }
  expect(pages.flatMap((result) => result.items.map((item) => item.id)).sort()).toEqual(suppliers.map((item) => item.id).sort());
});

test("invalid contact selections, field bounds and forged server fields never leave a supplier behind", async ({ page }) => {
  await authenticate(page, credentials.purchasing);
  const marker = uniqueValue("Invalid-supplier");
  const valid = supplierInput({ name: marker });
  const invalidBodies = [
    { ...valid, contacts: [] },
    { ...valid, contacts: [{ channel: "LINE", value: "@one" }, { channel: "LINE", value: "@two" }] },
    { ...valid, contacts: [{ channel: "FAX", value: "021234567" }] },
    { ...valid, contacts: [{ channel: "PHONE", value: "   " }] },
    { ...valid, contacts: [{ channel: "OTHER", value: "x".repeat(501) }] },
    { ...valid, contacts: [...valid.contacts, { channel: "EMAIL", value: "a@example.test" }, { channel: "OTHER", value: "other" }, { channel: "PHONE", value: "duplicate-sixth" }] },
    { ...valid, name: "   " },
    { ...valid, name: "x".repeat(201) },
    { ...valid, taxId: "x".repeat(51) },
    { ...valid, code: "SUP-00001", version: 999, isActive: false },
  ];
  const before = await listSuppliers(page, "", { limit: 1 });
  for (const data of invalidBodies) await expectStatus(await page.request.post("/api/suppliers", { data }), 400);
  expect((await listSuppliers(page, "", { limit: 1 })).totalCount).toBe(before.totalCount);
  expect((await listSuppliers(page, marker)).items).toEqual([]);
});

test("concurrent master creation allocates unique supplier codes without losing either record", async ({ page }) => {
  await authenticate(page, credentials.purchasing);
  const marker = uniqueValue("Concurrent-supplier");
  const results = await Promise.all([0, 1, 2].map((index) => page.request.post("/api/suppliers", {
    data: supplierInput({ name: `${marker} ${index}` }),
  })));
  const records: SupplierDetail[] = [];
  for (const response of results) {
    await expectStatus(response, 201);
    records.push(await response.json() as SupplierDetail);
  }
  expect(new Set(records.map((record) => record.code)).size).toBe(3);
  expect(new Set(records.map((record) => record.id)).size).toBe(3);
  expect((await listSuppliers(page, marker)).totalCount).toBe(3);
});

test("registered PO issuance reads the fresh master and later edits or deactivation never rewrite its snapshot", async ({ page }) => {
  await authenticate(page, credentials.purchasing);
  let supplier = await createSupplier(page);
  const request = await createApprovedRequest(page);
  supplier = await editedSupplier(await updateSupplier(page, supplier, {
    name: `${supplier.name} latest`, taxId: "LATEST-TAX-ID", address: "Latest supplier address", contactPerson: "Latest contact person",
    paymentTerms: "Net 45 days", contacts: [{ channel: "PHONE", value: "0822222222" }, { channel: "LINE", value: "@latest-sales" }],
  }));
  const document = await issuedOrder(page, await issueRegistered(page, request, supplier.id));
  expect(orderSnapshot(document)).toEqual(masterSnapshot(supplier));
  await editedSupplier(await updateSupplier(page, supplier, {
    name: "Changed after the purchase order was issued", address: "Different address after issue", taxId: "CHANGED-TAX-ID",
    contactPerson: "New contact", paymentTerms: "Cash", contacts: [{ channel: "EMAIL", value: "new-after-issue@example.test" }], isActive: false,
  }));
  const response = await page.request.get(`/api/purchase-orders/${document.id}`);
  await expectStatus(response, 200);
  expect(await response.json()).toEqual(document);
});

test("a later inactive or nonexistent registered supplier rolls back the complete PO batch", async ({ page }) => {
  await authenticate(page, credentials.purchasing);
  const active = await createSupplier(page);
  const disabled = await createSupplier(page);
  const inactive = await editedSupplier(await updateSupplier(page, disabled, { isActive: false }));
  const request = await createApprovedRequest(page);
  for (const supplierId of [inactive.id, "nonexistent-supplier-id"]) {
    const response = await page.request.post(`/api/purchase-requests/${request.id}/purchase-orders`, { data: { orders: [
      { supplierId: active.id, itemIds: [request.items[0]!.id] },
      { supplierId, itemIds: [request.items[1]!.id] },
    ] } });
    await expectStatus(response, 400);
    expect(await getRequest(page, request.id)).toEqual(request);
    expect(await getSupplier(page, active.id)).toEqual(active);
  }
});

test("registered supplier snapshots reject client overrides of identity, contacts and payment terms", async ({ page }) => {
  await authenticate(page, credentials.purchasing);
  const supplier = await createSupplier(page);
  const request = await createApprovedRequest(page);
  const order = { supplierId: supplier.id, itemIds: request.items.map((item) => item.id) };
  for (const extra of [
    { supplierName: "Forged supplier name" }, { supplierAddress: "Forged address" },
    { supplierContact: "Forged contact" }, { supplierTaxId: "Forged tax" },
    { supplierContacts: [{ channel: "PHONE", value: "0999999999" }] }, { paymentTerms: "Forged payment terms" },
  ]) {
    await expectStatus(await page.request.post(`/api/purchase-requests/${request.id}/purchase-orders`, {
      data: { orders: [{ ...order, ...extra }] },
    }), 400);
    expect(await getRequest(page, request.id)).toEqual(request);
  }
});

test("manual PO creation remains compatible and never invents a registered supplier", async ({ page }) => {
  const request = await createApprovedRequest(page);
  const manualName = uniqueValue("Legacy-manual-supplier");
  const document = await issuedOrder(page, await page.request.post(`/api/purchase-requests/${request.id}/purchase-orders`, {
    data: { orders: [{ supplierName: manualName, supplierContact: "Legacy phone contact", itemIds: request.items.map((item) => item.id) }] },
  }));
  expect(document).toMatchObject({
    supplierId: null, supplierCode: null, supplierTaxId: null, supplierContactPerson: null,
    supplierContacts: [], supplierName: manualName, supplierContact: "Legacy phone contact",
  });
  expect((await listSuppliers(page, manualName)).items).toEqual([]);
});

test("Purchasing creates and edits multiple contact channels through the Thai and English supplier UI", async ({ page }) => {
  await authenticate(page, credentials.purchasing);
  await page.goto("/suppliers");
  await expect(page.locator('header a[href="/suppliers"]')).toBeVisible();
  await page.locator("#create-supplier").click();
  const name = uniqueValue("Browser-supplier");
  await page.locator("#supplier-name").fill(name);
  for (const channel of ["LINE", "PHONE", "ECOMMERCE", "EMAIL", "OTHER"]) {
    await page.locator(`#supplier-channel-${channel}`).setChecked(["LINE", "PHONE", "ECOMMERCE"].includes(channel));
  }
  await page.locator("#supplier-contact-LINE").fill("@browser-sales");
  await page.locator("#supplier-contact-PHONE").fill("0833333333");
  await page.locator("#supplier-contact-ECOMMERCE").fill("https://shop.example.test/browser-supplier");
  const createResponse = page.waitForResponse((response) => response.url().endsWith("/api/suppliers") && response.request().method() === "POST");
  await page.locator("#save-supplier").click();
  const response = await createResponse;
  await expectStatus(response, 201);
  const supplier = await response.json() as SupplierDetail;
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("main")).toContainText(name);
  await page.getByRole("button", { name: `แก้ไข ${supplier.code}`, exact: true }).click();
  await page.locator("#supplier-channel-LINE").uncheck();
  await page.locator("#supplier-channel-EMAIL").check();
  await page.locator("#supplier-contact-EMAIL").fill("browser-edit@example.test");
  await page.locator("#supplier-contact-PHONE").fill("0844444444");
  const editResponse = page.waitForResponse((candidate) => candidate.url().endsWith(`/api/suppliers/${supplier.id}`) && candidate.request().method() === "PATCH");
  await page.locator("#save-supplier").click();
  await expectStatus(await editResponse, 200);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("main")).toContainText("browser-edit@example.test");
  const edited = await getSupplier(page, supplier.id);
  expect(contactsOf(edited.contacts)).toEqual(contactsOf([
    { channel: "PHONE", value: "0844444444" }, { channel: "ECOMMERCE", value: "https://shop.example.test/browser-supplier" },
    { channel: "EMAIL", value: "browser-edit@example.test" },
  ]));
  await page.getByRole("button", { name: "ภาษา: English" }).click();
  await expect(page.locator('header a[href="/suppliers"]')).toHaveText("Suppliers");
  await page.getByRole("button", { name: `Edit ${supplier.code}`, exact: true }).click();
  await expect(page.locator("#save-supplier")).toHaveText("Save supplier");
  await expect(page.locator("#supplier-channel-EMAIL")).toBeChecked();
  await expect(page.locator("#supplier-channel-LINE")).not.toBeChecked();
});

test("registered supplier selection prefills locked PO headers and issues all contact channels through the browser", async ({ page }) => {
  await authenticate(page, credentials.purchasing);
  const supplier = await createSupplier(page);
  const request = await createApprovedRequest(page);
  await page.goto(`/purchase-requests/${request.id}/purchase-orders/new`);
  for (const item of request.items) {
    await page.locator(`#po-supplier-${item.id}`).fill(supplier.code);
    await page.locator(`#po-supplier-${item.id}-listbox`).getByRole("option").filter({ hasText: supplier.code }).click();
  }
  for (const item of request.items) {
    await expect(page.locator(`#po-supplier-${item.id}`)).toHaveValue(supplier.name);
    await expect(page.locator(`#po-supplier-${item.id}`)).toHaveAttribute("role", "combobox");
    await expect(page.locator(`#po-supplier-${item.id}`)).toHaveJSProperty("readOnly", false);
  }
  await expect(page.locator("#po-supplier-address-0")).toHaveValue(supplier.address!);
  await expect(page.locator("#po-supplier-address-0")).toHaveJSProperty("readOnly", true);
  await expect(page.locator("#po-payment-terms-0")).toHaveValue(supplier.paymentTerms!);
  await expect(page.locator("#po-payment-terms-0")).toHaveJSProperty("readOnly", true);
  for (const contact of supplier.contacts) await expect(page.locator("#po-supplier-contacts-0")).toContainText(contact.value);
  const conversion = page.waitForResponse((response) => response.url().endsWith(`/purchase-requests/${request.id}/purchase-orders`) && response.request().method() === "POST");
  await page.locator("#create-purchase-orders").click();
  const response = await conversion;
  const posted = response.request().postDataJSON() as { orders: Array<Record<string, unknown>> };
  expect(posted.orders).toHaveLength(1);
  expect(posted.orders[0]).toMatchObject({ supplierId: supplier.id });
  for (const field of ["supplierName", "supplierAddress", "supplierContact", "paymentTerms"]) expect(posted.orders[0]).not.toHaveProperty(field);
  const document = await issuedOrder(page, response);
  expect(orderSnapshot(document)).toEqual(masterSnapshot(supplier));
  await page.goto(`/purchase-orders/${document.id}`);
  await expect(page.locator(".purchase-order-document")).toContainText(supplier.taxId!);
  await expect(page.locator(".purchase-order-document")).toContainText(supplier.contactPerson!);
  for (const contact of supplier.contacts) await expect(page.locator(".purchase-order-document")).toContainText(contact.value);
});

test("supplier editing racing PO issuance produces one complete old or new master snapshot", async ({ page }) => {
  await authenticate(page, credentials.purchasing);
  const supplier = await createSupplier(page, {
    name: uniqueValue("Coherent-snapshot-A"), taxId: "SNAPSHOT-A", address: "Address A", contactPerson: "Person A", paymentTerms: "Terms A",
    contacts: [{ channel: "LINE", value: "@snapshot-a" }, { channel: "PHONE", value: "0811111111" }],
  });
  const request = await createApprovedRequest(page);
  const [edit, issuance] = await Promise.all([
    updateSupplier(page, supplier, {
      name: uniqueValue("Coherent-snapshot-B"), taxId: "SNAPSHOT-B", address: "Address B", contactPerson: "Person B", paymentTerms: "Terms B",
      contacts: [{ channel: "ECOMMERCE", value: "https://shop.example.test/snapshot-b" }, { channel: "EMAIL", value: "snapshot-b@example.test" }],
    }),
    issueRegistered(page, request, supplier.id),
  ]);
  const edited = await editedSupplier(edit);
  const document = await issuedOrder(page, issuance);
  expect([masterSnapshot(supplier), masterSnapshot(edited)]).toContainEqual(orderSnapshot(document));
  expect(edited.version).toBe(supplier.version + 1);
  expect(document.purchaseRequest.status).toBe("ORDERED");
});

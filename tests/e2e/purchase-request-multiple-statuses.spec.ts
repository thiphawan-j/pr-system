import { expect, test, type Page } from "@playwright/test";

import type { PurchaseRequestListPage } from "../../src/lib/types";
import { authenticate, expectStatus, getRequest, receive } from "./receipt-support";
import {
  createRequestViaApi,
  credentials,
  postRequestAction,
  uniqueValue,
} from "./support";

const draftStatus = /^(ร่าง|Draft)$/i;
const pendingStatus = /^(รออนุมัติ|Pending approval)$/i;
const allStatuses = /^(ทั้งหมด|All)$/i;

async function search(page: Page) {
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /ค้นหา|search/i }).click();
}

test("multiple status selections survive search, reload, and pagination and can be cleared", async ({
  page,
}) => {
  await authenticate(page);
  const marker = uniqueValue("E2E-MULTI-STATUS");
  for (let index = 0; index < 11; index += 1) {
    await createRequestViaApi(page, {
      reason: `${marker} request ${index}`,
      submit: index % 2 === 1,
    });
  }
  const rejected = await createRequestViaApi(page, {
    reason: `${marker} rejected request`,
    submit: true,
  });
  await authenticate(page, credentials.approver);
  await expectStatus(
    await postRequestAction(page, rejected.id, "approval", {
      action: "REJECTED",
      comment: "Exclude this request when filtering drafts and pending approvals",
    }),
    200,
  );
  await authenticate(page);
  await page.goto(`/purchase-requests?query=${marker}&sort=pr_desc`);

  await page.locator("#status").click();
  await page.getByRole("menuitemcheckbox", { name: draftStatus }).click();
  // The menu remains open so the next status can be selected immediately.
  await page.getByRole("menuitemcheckbox", { name: pendingStatus }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: draftStatus })).toBeChecked();
  await expect(page.getByRole("menuitemcheckbox", { name: pendingStatus })).toBeChecked();
  await expect(page.getByRole("menuitemcheckbox", { name: allStatuses })).not.toBeChecked();
  await search(page);

  await expect(page).toHaveURL(/status=DRAFT/);
  expect(new URL(page.url()).searchParams.getAll("status")).toEqual([
    "DRAFT",
    "PENDING_APPROVAL",
  ]);
  const rows = page.locator("table tbody tr");
  await expect(rows).toHaveCount(10);
  await expect(rows.filter({ hasText: rejected.prNumber })).toHaveCount(0);
  await expect(rows.filter({ hasText: /ร่าง|Draft/i })).not.toHaveCount(0);
  await expect(rows.filter({ hasText: /รออนุมัติ|Pending approval/i })).not.toHaveCount(0);

  await page.reload();
  await page.locator("#status").click();
  await expect(page.getByRole("menuitemcheckbox", { name: draftStatus })).toBeChecked();
  await expect(page.getByRole("menuitemcheckbox", { name: pendingStatus })).toBeChecked();
  await page.keyboard.press("Escape");
  const secondPage = page.getByRole("link", { name: /Purchase Request: 2$/ });
  expect(new URL((await secondPage.getAttribute("href"))!, page.url()).searchParams.getAll("status"))
    .toEqual(["DRAFT", "PENDING_APPROVAL"]);
  await secondPage.click();
  await expect(page).toHaveURL(/page=2/);
  await expect(rows).toHaveCount(1);
  expect(new URL(page.url()).searchParams.getAll("status")).toEqual([
    "DRAFT",
    "PENDING_APPROVAL",
  ]);

  await page.locator("#status").click();
  await page.getByRole("menuitemcheckbox", { name: pendingStatus }).click();
  await search(page);
  await expect(rows).toHaveCount(6);
  expect(new URL(page.url()).searchParams.getAll("status")).toEqual(["DRAFT"]);
  await expect(rows.filter({ hasText: /รออนุมัติ|Pending approval/i })).toHaveCount(0);

  await page.locator("#status").click();
  await page.getByRole("menuitemcheckbox", { name: allStatuses }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: draftStatus })).not.toBeChecked();
  await expect(page.getByRole("menuitemcheckbox", { name: allStatuses })).toBeChecked();
  await search(page);
  await expect(rows).toHaveCount(10);
  expect(new URL(page.url()).searchParams.getAll("status")).toEqual([]);
  await expect(rows.filter({ hasText: rejected.prNumber })).toHaveCount(1);
});

test("status unions preserve receipt distinctions, other filters, and employee visibility", async ({
  page,
}) => {
  await authenticate(page);
  const marker = uniqueValue("E2E-STATUS-API");
  const ordered = await createRequestViaApi(page, {
    reason: `${marker} awaiting delivery`, submit: true,
  });
  const received = await createRequestViaApi(page, {
    reason: `${marker} awaiting documents`, submit: true,
  });
  const otherDepartment = await createRequestViaApi(page, {
    reason: `${marker} other department`, department: "Projects", submit: true,
  });
  const otherQuery = await createRequestViaApi(page, { submit: true });
  await createRequestViaApi(page, { reason: `${marker} draft must be excluded` });
  await authenticate(page, credentials.employee2);
  const otherOwner = await createRequestViaApi(page, {
    reason: `${marker} another employee`, submit: true,
  });

  const orders = [ordered, received, otherDepartment, otherQuery, otherOwner];
  await authenticate(page, credentials.admin);
  for (const request of orders) {
    await expectStatus(
      await postRequestAction(page, request.id, "approval", { action: "APPROVED" }),
      200,
    );
  }
  await authenticate(page, credentials.purchasing);
  for (const request of orders) {
    await expectStatus(
      await postRequestAction(page, request.id, "status", {
        action: "ORDERED", comment: `PO-${request.id}`,
      }),
      200,
    );
  }
  await authenticate(page);
  const detail = await getRequest(page, received.id);
  await expectStatus(
    await receive(page, detail, detail.items.map((item) => ({
      itemId: item.id, quantity: item.quantity,
    }))),
    200,
  );

  const today = new Date().toISOString().slice(0, 10);
  async function list(statuses: string[], extra: Record<string, string> = {}) {
    const params = new URLSearchParams({
      query: marker, department: "Operations", urgency: "NORMAL",
      from: today, to: today, ...extra,
    });
    for (const status of statuses) params.append("status", status);
    const response = await page.request.get(`/api/purchase-requests?${params}`);
    await expectStatus(response, 200);
    return (await response.json()) as PurchaseRequestListPage;
  }
  function ids(result: PurchaseRequestListPage) {
    return result.items.map((item) => item.id).sort();
  }

  const statuses = ["ORDERED", "AWAITING_RECEIPT_REFERENCES"];
  const union = await list(statuses);
  expect(union.totalCount).toBe(2);
  expect(ids(union)).toEqual([ordered.id, received.id].sort());
  expect(ids(await list(["ORDERED"]))).toEqual([ordered.id]);
  expect(ids(await list(["AWAITING_RECEIPT_REFERENCES"]))).toEqual([received.id]);
  expect(ids(await list(statuses, { preset: "awaiting_receipt" }))).toEqual([ordered.id]);
  expect(ids(await list([...statuses, "ORDERED"]))).toEqual(ids(union));
  expect((await list(statuses, { urgency: "URGENT" })).totalCount).toBe(0);

  await authenticate(page, credentials.employee2);
  const unrelatedEmployee = await list(statuses);
  expect(unrelatedEmployee.totalCount).toBe(1);
  expect(ids(unrelatedEmployee)).toEqual([otherOwner.id]);
});

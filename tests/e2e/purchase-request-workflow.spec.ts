import { expect, test, type Page } from "@playwright/test";

import {
  createRequestViaApi,
  credentials,
  postRequestAction,
  signIn,
  statusText,
  switchUser,
  uniqueValue,
} from "./support";

async function approveRequest(page: Page, requestId: string) {
  await switchUser(page, credentials.approver);
  const response = await postRequestAction(page, requestId, "approval", {
    action: "APPROVED",
    comment: "Approved during E2E setup",
  });
  expect(response.status()).toBe(200);
}

test("approver validation requires a reason before returning a request", async ({
  page,
}) => {
  await signIn(page);
  const request = await createRequestViaApi(page, { submit: true });

  await switchUser(page, credentials.approver);
  await page.goto(request.url);
  await page.getByRole("button", { name: /ส่งกลับแก้ไข|return for changes/i }).click();
  await expect(
    page.getByText(/กรุณาระบุเหตุผลหรือหมายเหตุ|provide.*reason/i),
  ).toBeVisible();

  const returnComment = uniqueValue("Return-comment");
  await page.locator("#approval-comment").fill(returnComment);
  await page.getByRole("button", { name: /ส่งกลับแก้ไข|return for changes/i }).click();
  await expect(page.locator("main")).toContainText(statusText.draft);
  await expect(page.locator("main")).toContainText(returnComment);

  await switchUser(page, credentials.employee);
  await page.goto(request.url);
  await expect(page.locator('a[href$="/edit"]')).toBeVisible();
});

test("approver can reject a submitted request", async ({ page }) => {
  await signIn(page);
  const request = await createRequestViaApi(page, { submit: true });
  const rejectComment = uniqueValue("Reject-comment");

  await switchUser(page, credentials.approver);
  await page.goto(request.url);
  await page.locator("#approval-comment").fill(rejectComment);
  await page.getByRole("button", { name: /ปฏิเสธ|reject/i }).click();

  await expect(page.locator("main")).toContainText(statusText.rejected);
  await expect(page.locator("main")).toContainText(rejectComment);
  await expect(page.locator('a[href$="/edit"]')).toHaveCount(0);
});

test("request completes approval, ordering, receipt, and document references", async ({
  page,
}) => {
  await signIn(page);
  const request = await createRequestViaApi(page, { submit: true });

  await switchUser(page, credentials.approver);
  await page.goto(request.url);
  await page.locator("#approval-comment").fill("Approved for full E2E flow");
  await page.getByRole("button", { name: /^อนุมัติ$|^approve$/i }).click();
  await expect(page.locator("main")).toContainText(statusText.approved);

  await switchUser(page, credentials.purchasing);
  await page.goto(request.url);
  await page.locator("#purchasing-comment").fill("PO-TEST-001");
  await page.getByRole("button", { name: /อนุมัติเปิด PO|approve po opening/i }).click();
  await expect(page.locator("main")).toContainText(statusText.ordered);

  await switchUser(page, credentials.employee);
  await page.goto(request.url);
  await page.locator("#receipt-comment").fill("Goods received in E2E");
  await page.getByRole("button", { name: /บันทึกรับของ|save received date/i }).click();
  await expect(page.locator("main")).toContainText(
    /รอบันทึกเลขเอกสาร|awaiting document numbers/i,
  );

  await switchUser(page, credentials.purchasing);
  await page.goto(request.url);
  await page.locator("#receipt-number").fill("RCV-E2E-001");
  await page.locator("#tax-invoice-number").fill("TAX-E2E-001");
  await page.locator("#receipt-reference-note").fill("Closed by full E2E flow");
  await page.getByRole("button", {
    name: /บันทึกเอกสารและปิดงาน|save documents and close/i,
  }).click();

  await expect(page.locator("main")).toContainText(statusText.completed);
  await expect(page.locator("main")).toContainText("RCV-E2E-001");
  await expect(page.locator("main")).toContainText("TAX-E2E-001");
});

test("purchasing can request revision and employee can resubmit", async ({ page }) => {
  await signIn(page);
  const request = await createRequestViaApi(page, { submit: true });
  await approveRequest(page, request.id);

  await switchUser(page, credentials.purchasing);
  await page.goto(request.url);
  const revisionComment = uniqueValue("Revision-needed");
  await page.locator("#purchasing-comment").fill(revisionComment);
  await page.getByRole("button", { name: /ส่งกลับแก้ไข|return for revision/i }).click();
  await expect(page.locator("main")).toContainText(statusText.revision);
  await expect(page.locator("main")).toContainText(revisionComment);

  await switchUser(page, credentials.employee);
  await page.goto(`${request.url}/edit`);
  const revisedReason = `Revised purchase request ${uniqueValue("E2E")}`;
  const requesterComment = uniqueValue("Requester-explanation");
  await page.locator("#reason").fill(revisedReason);
  await page.locator("#requesterComment").fill(requesterComment);
  await page.getByRole("button", {
    name: /ส่งกลับให้จัดซื้อตรวจอีกครั้ง|send back to purchasing/i,
  }).click();

  await expect(page.locator("main")).toContainText(statusText.approved);
  await expect(page.locator("main")).toContainText(revisedReason);
  await expect(page.locator("main")).toContainText(requesterComment);
});

test("visible users can add a timeline comment", async ({ page }) => {
  await signIn(page);
  const request = await createRequestViaApi(page);
  const comment = uniqueValue("Timeline-comment");

  await page.goto(request.url);
  await expect(
    page.getByRole("button", { name: /เพิ่มหมายเหตุ|add note/i }),
  ).toBeDisabled();
  await page.locator("#purchase-request-comment").fill(comment);
  const commentResponse = page.waitForResponse(
    (response) => response.url().endsWith(`/comments`),
  );
  await page.getByRole("button", { name: /เพิ่มหมายเหตุ|add note/i }).click();
  expect((await commentResponse).status()).toBe(200);

  await expect(page.locator("#purchase-request-comment")).toHaveValue("");
  await expect(page.locator("main")).toContainText(comment);
});

test("API enforces request visibility and workflow role boundaries", async ({ page }) => {
  await signIn(page);
  const ownRequest = await createRequestViaApi(page, { submit: true });

  const employeeApproval = await postRequestAction(
    page,
    ownRequest.id,
    "approval",
    { action: "APPROVED", comment: "Unauthorized employee approval" },
  );
  expect(employeeApproval.status()).toBe(403);

  await switchUser(page, credentials.purchasing);
  const otherRequests = await page.request.get(
    "/api/purchase-requests?query=Safety%20Helmet&page=1&limit=10",
  );
  expect(otherRequests.status()).toBe(200);
  const payload = (await otherRequests.json()) as {
    items: Array<{ id: string }>;
  };
  expect(payload.items).toHaveLength(1);
  const otherRequestId = payload.items[0]!.id;

  const purchasingApproval = await postRequestAction(
    page,
    ownRequest.id,
    "approval",
    { action: "APPROVED", comment: "Unauthorized purchasing approval" },
  );
  expect(purchasingApproval.status()).toBe(403);

  await switchUser(page, credentials.employee);
  const hiddenRequest = await page.request.get(
    `/api/purchase-requests/${otherRequestId}`,
  );
  expect(hiddenRequest.status()).toBe(403);

  const unauthorizedOrder = await postRequestAction(
    page,
    ownRequest.id,
    "status",
    { action: "ORDERED", comment: "Unauthorized order" },
  );
  expect(unauthorizedOrder.status()).toBe(403);
});

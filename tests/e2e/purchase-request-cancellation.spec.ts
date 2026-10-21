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
    comment: "Approved during cancellation E2E setup",
  });
  expect(response.status()).toBe(200);
}

test("a never-submitted draft can be deleted but a submitted PR cannot", async ({
  page,
}) => {
  await signIn(page);
  const draft = await createRequestViaApi(page);

  await page.goto(draft.url);
  await page.getByRole("button", { name: /ลบร่าง|delete draft/i }).click();
  const deleteResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/purchase-requests/${draft.id}`) &&
      response.request().method() === "DELETE",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /ลบร่าง|delete draft/i })
    .click();
  expect((await deleteResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/purchase-requests$/);
  expect((await page.request.get(`/api/purchase-requests/${draft.id}`)).status()).toBe(
    404,
  );

  const submitted = await createRequestViaApi(page, { submit: true });
  expect(
    (
      await page.request.delete(`/api/purchase-requests/${submitted.id}`)
    ).status(),
  ).toBe(400);
});

test("requester can directly cancel a pending PR with an immutable audit trail", async ({
  page,
}) => {
  await signIn(page);
  const request = await createRequestViaApi(page, { submit: true });

  const reason = uniqueValue("Pending-cancellation-reason");
  await page.goto(request.url);
  await page.getByRole("button", { name: /ยกเลิก PR|cancel PR/i }).click();
  const cancellationDialog = page.getByRole("dialog");
  await cancellationDialog
    .getByRole("button", { name: /ยกเลิก PR|cancel PR/i })
    .click();
  await expect(cancellationDialog.getByRole("alert")).toBeVisible();
  await cancellationDialog
    .getByLabel(/เหตุผลการยกเลิก|cancellation reason/i)
    .fill(reason);
  const cancellationResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(
        `/api/purchase-requests/${request.id}/cancellation`,
      ) && response.request().method() === "POST",
  );
  await cancellationDialog
    .getByRole("button", { name: /ยกเลิก PR|cancel PR/i })
    .click();
  expect((await cancellationResponse).status()).toBe(200);
  await expect(cancellationDialog).toBeHidden();

  const detailResponse = await page.request.get(`/api/purchase-requests/${request.id}`);
  expect(detailResponse.status()).toBe(200);
  const detail = (await detailResponse.json()) as {
    status: string;
    cancellationReason: string | null;
    cancelledAt: string | null;
    cancelledBy: { id: string; role: string } | null;
    approvals: Array<{ action: string; comment: string | null }>;
  };

  expect(detail.status).toBe("CANCELLED");
  expect(detail.cancellationReason).toBe(reason);
  expect(detail.cancelledAt).toBeTruthy();
  expect(detail.cancelledBy?.role).toBe("EMPLOYEE");
  expect(
    detail.approvals.filter((approval) => approval.action === "CANCELLED"),
  ).toEqual([expect.objectContaining({ comment: reason })]);

  await switchUser(page, credentials.approver);
  const staleApproval = await postRequestAction(page, request.id, "approval", {
    action: "APPROVED",
    comment: "Must not revive a cancelled request",
  });
  expect(staleApproval.status()).toBe(400);

  await switchUser(page, credentials.employee);
  const repeatedCancellation = await postRequestAction(
    page,
    request.id,
    "cancellation",
    { action: "CANCEL", reason: "Second cancellation attempt" },
  );
  expect(repeatedCancellation.status()).toBe(400);
});

test("approved PR cancellation can be declined and later confirmed by Purchasing", async ({
  page,
}) => {
  await signIn(page);
  const request = await createRequestViaApi(page, { submit: true });
  await approveRequest(page, request.id);

  await switchUser(page, credentials.employee);
  const firstReason = uniqueValue("Cancellation-request");
  await page.goto(request.url);
  await page
    .getByRole("button", { name: /ขอยกเลิก PR|request cancellation/i })
    .click();
  let cancellationDialog = page.getByRole("dialog");
  await cancellationDialog
    .getByLabel(/เหตุผลการยกเลิก|cancellation reason/i)
    .fill(firstReason);
  let cancellationResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(
        `/api/purchase-requests/${request.id}/cancellation`,
      ) && response.request().method() === "POST",
  );
  await cancellationDialog
    .getByRole("button", { name: /ขอยกเลิก PR|request cancellation/i })
    .click();
  expect((await cancellationResponse).status()).toBe(200);
  await expect(cancellationDialog).toBeHidden();
  await page.reload();
  await expect(page.locator("main")).toContainText(statusText.cancelRequested);
  await expect(page.locator("main")).toContainText(firstReason);

  await switchUser(page, credentials.purchasing);
  const declineReason = uniqueValue("Cancellation-declined");
  await page.goto(request.url);
  await page
    .getByRole("button", { name: /ไม่อนุมัติการยกเลิก|decline cancellation/i })
    .click();
  cancellationDialog = page.getByRole("dialog");
  await cancellationDialog
    .getByRole("button", { name: /ไม่อนุมัติการยกเลิก|decline cancellation/i })
    .click();
  await expect(cancellationDialog.getByRole("alert")).toBeVisible();
  await cancellationDialog
    .getByLabel(/เหตุผลที่ไม่อนุมัติ|reason for declining/i)
    .fill(declineReason);
  cancellationResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(
        `/api/purchase-requests/${request.id}/cancellation`,
      ) && response.request().method() === "POST",
  );
  await cancellationDialog
    .getByRole("button", { name: /ไม่อนุมัติการยกเลิก|decline cancellation/i })
    .click();
  expect((await cancellationResponse).status()).toBe(200);

  let detail = (await (
    await page.request.get(`/api/purchase-requests/${request.id}`)
  ).json()) as {
    status: string;
    cancellationReason: string | null;
    approvals: Array<{ action: string; comment: string | null }>;
  };
  expect(detail.status).toBe("APPROVED");
  expect(detail.cancellationReason).toBeNull();
  expect(detail.approvals).toContainEqual(
    expect.objectContaining({
      action: "CANCELLATION_DECLINED",
      comment: declineReason,
    }),
  );

  await switchUser(page, credentials.employee);
  const finalReason = uniqueValue("Cancellation-request-final");
  expect(
    (
      await postRequestAction(page, request.id, "cancellation", {
        action: "REQUEST",
        reason: finalReason,
      })
    ).status(),
  ).toBe(200);

  await switchUser(page, credentials.purchasing);
  await page.goto(request.url);
  await page
    .getByRole("button", {
      name: /^(อนุมัติการยกเลิก|approve cancellation)$/i,
    })
    .click();
  cancellationDialog = page.getByRole("dialog");
  await cancellationDialog
    .getByLabel(/หมายเหตุการอนุมัติ|approval note/i)
    .fill("PO has not been opened");
  cancellationResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(
        `/api/purchase-requests/${request.id}/cancellation`,
      ) && response.request().method() === "POST",
  );
  await cancellationDialog
    .getByRole("button", {
      name: /^(อนุมัติการยกเลิก|approve cancellation)$/i,
    })
    .click();
  expect((await cancellationResponse).status()).toBe(200);

  detail = (await (
    await page.request.get(`/api/purchase-requests/${request.id}`)
  ).json()) as typeof detail;
  expect(detail.status).toBe("CANCELLED");
  expect(detail.cancellationReason).toBe(finalReason);
  expect(detail.approvals).toContainEqual(
    expect.objectContaining({ action: "CANCELLED" }),
  );
});

test("requester cannot review their own cancellation request", async ({ page }) => {
  await signIn(page, credentials.purchasing);
  const request = await createRequestViaApi(page, { submit: true });
  await approveRequest(page, request.id);

  await switchUser(page, credentials.purchasing);
  expect(
    (
      await postRequestAction(page, request.id, "cancellation", {
        action: "REQUEST",
        reason: "Purchasing requester needs an independent review",
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await postRequestAction(page, request.id, "cancellation", {
        action: "CONFIRM",
        reason: "Self-approval must not be allowed",
      })
    ).status(),
  ).toBe(403);

  await switchUser(page, credentials.admin);
  expect(
    (
      await postRequestAction(page, request.id, "cancellation", {
        action: "CONFIRM",
        reason: "Reviewed independently by an administrator",
      })
    ).status(),
  ).toBe(200);
});

test("Management approver has Admin-equivalent cancellation rights", async ({
  page,
}) => {
  await signIn(page);
  const draft = await createRequestViaApi(page);
  const pending = await createRequestViaApi(page, { submit: true });
  const approved = await createRequestViaApi(page, { submit: true });
  const ordered = await createRequestViaApi(page, { submit: true });

  await switchUser(page, credentials.management);
  await page.goto(draft.url);
  await expect(
    page.getByRole("button", { name: /ลบร่าง|delete draft/i }),
  ).toBeVisible();
  expect((await page.request.delete(`/api/purchase-requests/${draft.id}`)).status()).toBe(
    200,
  );

  await switchUser(page, credentials.approver);
  expect(
    (
      await postRequestAction(page, pending.id, "cancellation", {
        action: "CANCEL",
        reason: "An ordinary approver must not have Management rights",
      })
    ).status(),
  ).toBe(403);

  await switchUser(page, credentials.management);
  await page.goto(pending.url);
  await expect(
    page.getByRole("button", { name: /ยกเลิก PR|cancel PR/i }),
  ).toBeVisible();
  expect(
    (
      await postRequestAction(page, pending.id, "cancellation", {
        action: "CANCEL",
        reason: "Cancelled directly by Management",
      })
    ).status(),
  ).toBe(200);

  await approveRequest(page, approved.id);
  await switchUser(page, credentials.employee);
  expect(
    (
      await postRequestAction(page, approved.id, "cancellation", {
        action: "REQUEST",
        reason: "Management review is required",
      })
    ).status(),
  ).toBe(200);
  await switchUser(page, credentials.management);
  await page.goto(approved.url);
  await expect(
    page.getByRole("button", {
      name: /^(อนุมัติการยกเลิก|approve cancellation)$/i,
    }),
  ).toBeVisible();
  expect(
    (
      await postRequestAction(page, approved.id, "cancellation", {
        action: "CONFIRM",
        reason: "Cancellation reviewed by Management",
      })
    ).status(),
  ).toBe(200);

  await approveRequest(page, ordered.id);
  await switchUser(page, credentials.purchasing);
  expect(
    (
      await postRequestAction(page, ordered.id, "status", {
        action: "ORDERED",
        comment: "PO opened before Management cancellation",
      })
    ).status(),
  ).toBe(200);
  await switchUser(page, credentials.management);
  expect(
    (
      await postRequestAction(page, ordered.id, "cancellation", {
        action: "CANCEL",
        reason: "PO cancellation confirmed by Management",
        cancellationReference: uniqueValue("MGT-PO-CANCEL"),
      })
    ).status(),
  ).toBe(200);
});

test("Purchasing can cancel an ordered PR and a PO reference is required", async ({
  page,
}) => {
  await signIn(page);
  const request = await createRequestViaApi(page, { submit: true });
  await approveRequest(page, request.id);

  await switchUser(page, credentials.purchasing);
  expect(
    (
      await postRequestAction(page, request.id, "status", {
        action: "ORDERED",
        comment: "PO-E2E-CANCEL",
      })
    ).status(),
  ).toBe(200);

  await switchUser(page, credentials.employee);
  expect(
    (
      await postRequestAction(page, request.id, "cancellation", {
        action: "CANCEL",
        reason: "Requester cannot cancel an opened PO",
        cancellationReference: "PO-CANCEL-UNAUTHORIZED",
      })
    ).status(),
  ).toBe(403);

  await switchUser(page, credentials.purchasing);
  expect(
    (
      await postRequestAction(page, request.id, "cancellation", {
        action: "CANCEL",
        reason: "Vendor accepted the PO cancellation",
      })
    ).status(),
  ).toBe(400);

  const cancellationReference = uniqueValue("PO-CANCEL");
  expect(
    (
      await postRequestAction(page, request.id, "cancellation", {
        action: "CANCEL",
        reason: "Vendor accepted the PO cancellation",
        cancellationReference,
      })
    ).status(),
  ).toBe(200);

  const detail = (await (
    await page.request.get(`/api/purchase-requests/${request.id}`)
  ).json()) as {
    status: string;
    cancellationReference: string | null;
    cancelledBy: { role: string } | null;
  };
  expect(detail.status).toBe("CANCELLED");
  expect(detail.cancellationReference).toBe(cancellationReference);
  expect(detail.cancelledBy?.role).toBe("PURCHASING");

  await switchUser(page, credentials.employee);
  const receivedRequest = await createRequestViaApi(page, { submit: true });
  await approveRequest(page, receivedRequest.id);
  await switchUser(page, credentials.purchasing);
  expect(
    (
      await postRequestAction(page, receivedRequest.id, "status", {
        action: "ORDERED",
        comment: "PO that will be received",
      })
    ).status(),
  ).toBe(200);
  await switchUser(page, credentials.employee);
  expect(
    (
      await postRequestAction(page, receivedRequest.id, "status", {
        action: "RECEIVED",
        receivedDate: new Date().toISOString().slice(0, 10),
        comment: "Goods received before cancellation attempt",
      })
    ).status(),
  ).toBe(200);
  await switchUser(page, credentials.purchasing);
  expect(
    (
      await postRequestAction(page, receivedRequest.id, "cancellation", {
        action: "CANCEL",
        reason: "This must be rejected after receipt",
        cancellationReference: "PO-CANCEL-TOO-LATE",
      })
    ).status(),
  ).toBe(400);
});

test("concurrent cancellation attempts create one terminal transition", async ({
  page,
}) => {
  await signIn(page);
  const request = await createRequestViaApi(page, { submit: true });

  const responses = await Promise.all([
    postRequestAction(page, request.id, "cancellation", {
      action: "CANCEL",
      reason: "First concurrent cancellation",
    }),
    postRequestAction(page, request.id, "cancellation", {
      action: "CANCEL",
      reason: "Second concurrent cancellation",
    }),
  ]);

  const statuses = responses.map((response) => response.status());
  expect(statuses.filter((status) => status === 200)).toHaveLength(1);
  expect(statuses.some((status) => status === 400 || status === 409)).toBe(true);

  const detail = (await (
    await page.request.get(`/api/purchase-requests/${request.id}`)
  ).json()) as {
    status: string;
    approvals: Array<{ action: string }>;
  };
  expect(detail.status).toBe("CANCELLED");
  expect(
    detail.approvals.filter((approval) => approval.action === "CANCELLED"),
  ).toHaveLength(1);
});

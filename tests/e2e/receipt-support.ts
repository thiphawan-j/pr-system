import { expect, type APIResponse, type Page } from "@playwright/test";

import type { PurchaseRequestDetail } from "../../src/lib/types";
import { credentials, type Credentials, uniqueValue } from "./support";

export const receivedDate = "2026-10-20";

export async function expectStatus(response: Pick<APIResponse, "status" | "text">, status: number) {
  expect(response.status(), await response.text()).toBe(status);
}

export async function authenticate(page: Page, account: Credentials = credentials.employee) {
  await page.context().clearCookies();
  await expectStatus(
    // Re-establish a reset test-server connection only during session setup.
    // HTTP errors and the purchasing/receipt mutations still fail immediately.
    await page.request.post("/api/auth/login", { data: account, maxRetries: 1 }),
    200,
  );
}

export async function getRequest(page: Page, id: string) {
  const response = await page.request.get(`/api/purchase-requests/${id}`);
  await expectStatus(response, 200);
  return (await response.json()) as PurchaseRequestDetail;
}

export async function createOrderedRequest(page: Page, quantities = [100, 10]) {
  const marker = uniqueValue("E2E-receipts");
  const response = await page.request.post("/api/purchase-requests", {
    multipart: {
      payload: JSON.stringify({
        requestDate: receivedDate,
        department: "Operations",
        reason: `Purchase request for receipt testing ${marker}`,
        urgency: "NORMAL",
        submit: true,
        items: quantities.map((quantity, index) => ({
          itemName: `${marker} item ${index + 1}`,
          quantity,
          unit: "ชิ้น",
          unitPrice: 10,
          amount: quantity * 10,
        })),
      }),
    },
  });
  await expectStatus(response, 200);
  const { id } = (await response.json()) as { id: string };

  await authenticate(page, credentials.approver);
  await expectStatus(
    await page.request.post(`/api/purchase-requests/${id}/approval`, {
      data: { action: "APPROVED", comment: "Approved for receipt E2E tests" },
    }),
    200,
  );
  await authenticate(page, credentials.purchasing);
  await expectStatus(
    await page.request.post(`/api/purchase-requests/${id}/status`, {
      data: { action: "ORDERED", comment: `PO-${marker}` },
    }),
    200,
  );
  await authenticate(page, credentials.employee);
  return getRequest(page, id);
}

export function receive(
  page: Page,
  request: PurchaseRequestDetail,
  items: Array<{ itemId: string; quantity: number }>,
  extra: Record<string, unknown> = {},
) {
  return page.request.post(`/api/purchase-requests/${request.id}/receipts`, {
    data: {
      action: "RECEIVED",
      expectedVersion: request.receiptVersion,
      receivedDate,
      items,
      ...extra,
    },
  });
}


import { expect, type Page } from "@playwright/test";

export type Credentials = {
  identifier: string;
  password: string;
};

export const credentials = {
  employee: { identifier: "somchai", password: "Passw0rd!" },
  employeeByEmail: {
    identifier: "employee@demo.local",
    password: "Passw0rd!",
  },
  employeeByPhone: { identifier: "0811111111", password: "Passw0rd!" },
  employee2: { identifier: "orathai", password: "Passw0rd!" },
  approver: { identifier: "0811111112", password: "Passw0rd!" },
  purchasing: { identifier: "kitti", password: "Passw0rd!" },
  admin: { identifier: "admin", password: "Passw0rd!" },
} satisfies Record<string, Credentials>;

export const statusText = {
  draft: /Draft|ร่าง/i,
  pending: /รออนุมัติ|pending approval/i,
  approved: /อนุมัติแล้ว|approved/i,
  revision: /รอแก้ไขจากผู้ขอซื้อ|waiting for requester revision/i,
  rejected: /ถูกปฏิเสธ|rejected/i,
  ordered: /สั่งซื้อแล้ว|ordered/i,
  completed: /เสร็จสมบูรณ์|completed/i,
};

let uniqueCounter = 0;

export function uniqueValue(prefix: string) {
  uniqueCounter += 1;
  return `${prefix}-${Date.now()}-${uniqueCounter}`;
}

export async function signIn(
  page: Page,
  account: Credentials = credentials.employee,
) {
  await page.goto("/login");
  await page.locator("#identifier").fill(account.identifier);
  await page.locator("#password").fill(account.password);

  const loginResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/login") &&
      response.request().method() === "POST",
  );

  await page.getByRole("button", { name: /เข้าสู่ระบบ|sign in/i }).click();
  expect((await loginResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
  await expect(page.locator("main")).toBeVisible();
}

export async function switchUser(page: Page, account: Credentials) {
  await page.context().clearCookies();
  await signIn(page, account);
}

export async function signOut(page: Page) {
  await Promise.all([
    page.waitForURL(/\/login$/, { timeout: 15_000 }),
    page.getByRole("button", { name: /ออกจากระบบ|sign out/i }).click(),
  ]);
}

type CreateRequestOptions = {
  submit?: boolean;
  reason?: string;
  itemName?: string;
  description?: string;
  supplierName?: string;
  urgency?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  department?:
    | "Operations"
    | "Projects"
    | "Finance"
    | "IT"
    | "Admin"
    | "Purchasing"
    | "ซ่อมบำรุง"
    | "บริหาร/จัดการ";
};

export type CreatedRequest = {
  id: string;
  url: string;
  reason: string;
  itemName: string;
  prNumber: string;
};

export async function createRequestViaApi(
  page: Page,
  options: CreateRequestOptions = {},
): Promise<CreatedRequest> {
  const marker = uniqueValue("E2E-PR");
  const reason = options.reason ?? `Purchase request for ${marker}`;
  const itemName = options.itemName ?? `Product ${marker}`;
  const payload = {
    requestDate: new Date().toISOString().slice(0, 10),
    department: options.department ?? "Operations",
    reason,
    urgency: options.urgency ?? "NORMAL",
    items: [
      {
        itemName,
        description: options.description ?? `Description ${marker}`,
        supplierName: options.supplierName ?? `Supplier ${marker}`,
        quantity: 2,
        unit: "ชิ้น",
        unitPrice: 1250,
        amount: 2500,
      },
    ],
    submit: options.submit ?? false,
  };

  const createResponse = await page.request.post("/api/purchase-requests", {
    multipart: {
      payload: JSON.stringify(payload),
    },
  });

  if (!createResponse.ok()) {
    throw new Error(
      `Unable to create E2E purchase request: ${createResponse.status()} ${await createResponse.text()}`,
    );
  }

  const { id } = (await createResponse.json()) as { id: string };
  const detailResponse = await page.request.get(`/api/purchase-requests/${id}`);

  if (!detailResponse.ok()) {
    throw new Error(
      `Unable to read E2E purchase request: ${detailResponse.status()} ${await detailResponse.text()}`,
    );
  }

  const detail = (await detailResponse.json()) as { prNumber: string };

  return {
    id,
    url: `/purchase-requests/${id}`,
    reason,
    itemName,
    prNumber: detail.prNumber,
  };
}

export async function createRequestViaUi(
  page: Page,
  options: CreateRequestOptions = {},
): Promise<CreatedRequest> {
  const marker = uniqueValue("E2E-UI");
  const reason = options.reason ?? `Purchase request for ${marker}`;
  const itemName = options.itemName ?? `Product ${marker}`;

  await page.goto("/purchase-requests/new");
  await page.locator("#reason").fill(reason);
  await page.locator('input[name="items.0.itemName"]').fill(itemName);
  await page.locator('input[name="items.0.description"]').fill(
    options.description ?? `Description ${marker}`,
  );
  await page.locator('input[name="items.0.unitPrice"]').fill("1250");
  await page.locator('input[name="items.0.supplierName"]').fill(
    options.supplierName ?? `Supplier ${marker}`,
  );

  const buttonName = options.submit
    ? /บันทึกและส่งอนุมัติ|save and submit/i
    : /บันทึกร่าง|save draft/i;
  await page.getByRole("button", { name: buttonName }).click();

  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toContainText(/^PR-/, { timeout: 15_000 });
  const prNumber = (await heading.textContent())?.trim() ?? "";
  const url = new URL(page.url());
  const id = url.pathname.split("/").at(-1) ?? "";

  return { id, url: url.pathname, reason, itemName, prNumber };
}

export async function postRequestAction(
  page: Page,
  requestId: string,
  endpoint: "approval" | "status" | "receipt-references" | "comments" | "submit",
  data?: Record<string, unknown>,
) {
  return page.request.post(`/api/purchase-requests/${requestId}/${endpoint}`, {
    data,
  });
}

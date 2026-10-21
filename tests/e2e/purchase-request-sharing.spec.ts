import { expect, test, type Page } from "@playwright/test";

import { SESSION_COOKIE_NAME } from "../../src/lib/auth";
import { authenticate, expectStatus, getRequest } from "./receipt-support";
import {
  createRequestViaApi,
  credentials,
  type Credentials,
  uniqueValue,
} from "./support";

type ShareMockState = {
  copiedLinks: string[];
  nativeShares: ShareData[];
  finishNativeShare?: () => void;
};

declare global {
  interface Window {
    __prShareE2E: ShareMockState;
  }
}

async function installShareMocks(
  page: Page,
  clipboard: "available" | "unavailable" | "denied" = "available",
  native: "absent" | "pending" | "cancel" | "denied" = "absent",
) {
  await page.addInitScript(({ clipboardMode, nativeMode }) => {
    const state: ShareMockState = { copiedLinks: [], nativeShares: [] };
    window.__prShareE2E = state;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: clipboardMode === "unavailable" ? undefined : {
        writeText: async (value: string) => {
          state.copiedLinks.push(value);
          if (clipboardMode === "denied") {
            throw new DOMException("Clipboard permission denied", "NotAllowedError");
          }
        },
      },
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: nativeMode === "absent" ? undefined : (data: ShareData) => {
        state.nativeShares.push(data);
        if (nativeMode === "cancel") {
          return Promise.reject(new DOMException("The user cancelled sharing", "AbortError"));
        }
        if (nativeMode === "denied") {
          return Promise.reject(new DOMException("Native sharing permission denied", "NotAllowedError"));
        }
        return new Promise<void>((resolve) => { state.finishNativeShare = resolve; });
      },
    });
  }, { clipboardMode: clipboard, nativeMode: native });
}

async function openShareDialog(page: Page) {
  await page.locator("#share-pr-button").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("#share-pr-link")).toHaveJSProperty("readOnly", true);
  return page.locator("#share-pr-link").inputValue();
}

async function submitLogin(page: Page, account: Credentials = credentials.employee) {
  // A working password toggle proves the form is hydrated before submission.
  await page.getByRole("button", { name: /แสดงรหัสผ่าน|show password/i }).click();
  await expect(page.locator("#password")).toHaveAttribute("type", "text");
  await page.locator("#identifier").fill(account.identifier);
  await page.locator("#password").fill(account.password);
  const response = page.waitForResponse((candidate) =>
    candidate.url().endsWith("/api/auth/login") && candidate.request().method() === "POST",
  );
  await page.getByRole("button", { name: /เข้าสู่ระบบ|sign in/i }).click();
  await expectStatus(await response, 200);
}

async function expectSelectedLink(page: Page, expectedLink: string) {
  const link = page.locator("#share-pr-link");
  await expect(link).toBeFocused();
  expect(await link.evaluate((element) => {
    const input = element as HTMLInputElement;
    return input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0);
  })).toBe(expectedLink);
}

test("copying shares the canonical browser-origin PR URL in Thai and English without changing the PR", async ({ page }) => {
  await installShareMocks(page);
  await authenticate(page);
  const request = await createRequestViaApi(page);
  const before = await getRequest(page, request.id);
  await page.goto(`${request.url}?from=notification&privateSearch=do-not-share#receipt-history`);
  const canonicalLink = new URL(request.url, page.url()).href;
  await expect(page.locator("#share-pr-button")).toHaveText("แชร์ PR");
  expect(await openShareDialog(page)).toBe(canonicalLink);
  await expectSelectedLink(page, canonicalLink);
  await expect(page.locator("#native-share-pr-link")).toHaveCount(0);
  await page.locator("#copy-share-pr-link").click();
  await expect(page.locator("#share-pr-feedback")).toHaveText("คัดลอกลิงก์แล้ว");
  expect(await page.evaluate(() => window.__prShareE2E.copiedLinks)).toEqual([canonicalLink]);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "ภาษา: English" }).click();
  await expect(page.locator("#share-pr-button")).toHaveText("Share PR");
  expect(await openShareDialog(page)).toBe(canonicalLink);
  await expect(page.locator("#copy-share-pr-link")).toHaveText("Copy link");
  await page.locator("#copy-share-pr-link").click();
  await expect(page.locator("#share-pr-feedback")).toHaveText("Link copied");
  expect(await page.evaluate(() => window.__prShareE2E.copiedLinks)).toEqual([canonicalLink, canonicalLink]);
  const after = await getRequest(page, request.id);
  expect(after.status).toBe(before.status);
  expect(after.receiptVersion).toBe(before.receiptVersion);
  expect(after.approvals).toEqual(before.approvals);
});

test("Purchasing can open the shared URL and order an approved PR with its existing permissions", async ({ page }) => {
  await authenticate(page);
  const request = await createRequestViaApi(page, { submit: true });
  await page.goto(request.url);
  const sharedLink = await openShareDialog(page);
  await authenticate(page, credentials.approver);
  await expectStatus(await page.request.post(`/api/purchase-requests/${request.id}/approval`, {
    data: { action: "APPROVED", comment: "Approved before sharing with Purchasing" },
  }), 200);

  await authenticate(page, credentials.purchasing);
  await page.goto(sharedLink);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(request.prNumber);
  await page.locator("#purchasing-comment").fill(uniqueValue("PO-SHARED-PR"));
  const orderResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/purchase-requests/${request.id}/status`) && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /อนุมัติเปิด PO|approve po opening/i }).click();
  await expectStatus(await orderResponse, 200);
  expect((await getRequest(page, request.id)).status).toBe("ORDERED");
});

test("the assigned approver can follow the shared URL and approve the original PR", async ({ page }) => {
  await authenticate(page);
  const request = await createRequestViaApi(page, { submit: true });
  await page.goto(request.url);
  const sharedLink = await openShareDialog(page);
  await authenticate(page, credentials.approver);
  await page.goto(sharedLink);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(request.prNumber);
  await page.locator("#approval-comment").fill("Reviewed using the shared PR link");
  const approvalResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/purchase-requests/${request.id}/approval`) && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /^อนุมัติ$|^approve$/i }).click();
  await expectStatus(await approvalResponse, 200);
  expect((await getRequest(page, request.id)).status).toBe("APPROVED");
});

for (const sessionState of ["guest", "invalid session with a forged return-path header"] as const) {
  test(`${sessionState} follows the shared link through login and returns to the same PR`, async ({ page }) => {
    await authenticate(page);
    const request = await createRequestViaApi(page);
    await page.goto(request.url);
    const sharedLink = await openShareDialog(page);
    await page.context().clearCookies();
    if (sessionState !== "guest") {
      await page.context().addCookies([{
        name: SESSION_COOKIE_NAME,
        value: "invalid-sharing-test-session",
        url: new URL(sharedLink).origin,
      }]);
      await page.setExtraHTTPHeaders({ "x-pr-login-return-path": "//external.invalid/steal-session" });
    }
    await page.goto(sharedLink);
    await expect(page).toHaveURL((url) => url.pathname === "/login" && url.searchParams.get("next") === request.url);
    await submitLogin(page);
    await expect(page).toHaveURL(sharedLink, { timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(request.prNumber);
    await expect(page.locator("main")).toContainText(request.reason);
  });
}

test("a shared link grants an unrelated employee neither PR data nor workflow access", async ({ page }) => {
  await authenticate(page);
  const request = await createRequestViaApi(page, { submit: true });
  await page.goto(request.url);
  const sharedLink = await openShareDialog(page);
  await authenticate(page, credentials.employee2);
  await page.goto(sharedLink);
  await expect(page.getByRole("heading", { name: /เกิดข้อผิดพลาดที่ไม่คาดคิด|something went wrong/i })).toBeVisible();
  await expect(page.locator("#share-pr-button")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(request.reason);
  await expectStatus(await page.request.get(`/api/purchase-requests/${request.id}`), 403);
  await expectStatus(await page.request.post(`/api/purchase-requests/${request.id}/comments`, {
    data: { comment: "Knowing the shared URL must not grant permission to comment" },
  }), 403);
});

for (const clipboard of ["unavailable", "denied"] as const) {
  test(`an ${clipboard} clipboard selects the URL and provides a usable manual-copy fallback`, async ({ page }) => {
    await installShareMocks(page, clipboard);
    await authenticate(page);
    const request = await createRequestViaApi(page);
    await page.goto(request.url);
    const sharedLink = await openShareDialog(page);
    await page.locator("#copy-share-pr-link").click();
    await expect(page.locator("#share-pr-feedback")).toContainText(/คัดลอกด้วยตนเอง|copy it manually/i);
    await expectSelectedLink(page, sharedLink);
    await expect(page.locator("#share-pr-link")).toHaveAttribute("aria-describedby", "share-pr-feedback");
    await page.getByRole("button", { name: /เลือกลิงก์เพื่อคัดลอกเอง|select link to copy manually/i }).click();
    await expectSelectedLink(page, sharedLink);
    await expect(page.locator("#copy-share-pr-link")).toBeEnabled();
    expect(await page.evaluate(() => window.__prShareE2E.copiedLinks))
      .toEqual(clipboard === "denied" ? [sharedLink] : []);
  });
}

test("native sharing sends PR metadata and the canonical URL while preventing duplicate actions", async ({ page }) => {
  await installShareMocks(page, "available", "pending");
  await authenticate(page);
  const request = await createRequestViaApi(page);
  await page.goto(`${request.url}?private=exclude#exclude`);
  const sharedLink = await openShareDialog(page);
  const nativeShare = page.locator("#native-share-pr-link");
  await nativeShare.click();
  await expect(nativeShare).toBeDisabled();
  await expect(page.locator("#copy-share-pr-link")).toBeDisabled();
  expect(await page.evaluate(() => window.__prShareE2E.nativeShares)).toEqual([{
    title: request.prNumber,
    text: request.reason,
    url: sharedLink,
  }]);
  expect(sharedLink).toBe(new URL(request.url, page.url()).href);
  await page.evaluate(() => window.__prShareE2E.finishNativeShare?.());
  await expect(page.locator("#share-pr-feedback")).toContainText(/แชร์ลิงก์แล้ว|link shared/i);
  await expect(nativeShare).toBeEnabled();
  await expect(page.locator("#copy-share-pr-link")).toBeEnabled();
});

test("cancelling native sharing is quiet and leaves copying available", async ({ page }) => {
  await installShareMocks(page, "available", "cancel");
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await authenticate(page);
  const request = await createRequestViaApi(page);
  await page.goto(request.url);
  const sharedLink = await openShareDialog(page);
  await page.locator("#native-share-pr-link").click();
  await expect.poll(() => page.evaluate(() => window.__prShareE2E.nativeShares.length)).toBe(1);
  await expect(page.locator("#native-share-pr-link")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#share-pr-feedback")).toHaveCount(0);
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0);
  expect(browserErrors).toEqual([]);
  await page.locator("#copy-share-pr-link").click();
  await expect(page.locator("#share-pr-feedback")).toContainText(/คัดลอกลิงก์แล้ว|link copied/i);
  expect(await page.evaluate(() => window.__prShareE2E.copiedLinks)).toEqual([sharedLink]);
});

test("denied native sharing selects the manual fallback and still allows copying the PR link", async ({ page }) => {
  await installShareMocks(page, "available", "denied");
  await authenticate(page);
  const request = await createRequestViaApi(page);
  await page.goto(request.url);
  const sharedLink = await openShareDialog(page);
  await page.locator("#native-share-pr-link").click();
  await expect(page.locator("#share-pr-feedback")).toContainText(/เปิดตัวเลือกการแชร์ไม่สำเร็จ|unable to open share options/i);
  await expectSelectedLink(page, sharedLink);
  await expect(page.getByRole("button", { name: /เลือกลิงก์เพื่อคัดลอกเอง|select link to copy manually/i })).toBeVisible();
  await expect(page.locator("#native-share-pr-link")).toBeEnabled();
  await expect(page.locator("#copy-share-pr-link")).toBeEnabled();
  await page.locator("#copy-share-pr-link").click();
  await expect(page.locator("#share-pr-feedback")).toContainText(/คัดลอกลิงก์แล้ว|link copied/i);
  expect(await page.evaluate(() => window.__prShareE2E.copiedLinks)).toEqual([sharedLink]);
  expect(await page.evaluate(() => window.__prShareE2E.nativeShares)).toHaveLength(1);
});

const rejectedReturnTargets = [
  {
    name: "external and protocol-relative return targets",
    values: [
      "https://external.invalid/steal-session",
      "//external.invalid/steal-session",
      "javascript:alert(1)",
      "/reports",
    ],
  },
  {
    name: "backslash, encoded, and noncanonical PR return targets",
    values: [
      String.raw`\\external.invalid\steal-session`,
      String.raw`/\external.invalid/steal-session`,
      "%2f%2fexternal.invalid/steal-session",
      "%5c%5cexternal.invalid/steal-session",
      "/purchase-requests/new",
      "/purchase-requests/example-id/edit?next=//external.invalid",
    ],
  },
];

for (const category of rejectedReturnTargets) {
  test(`${category.name} fall back to the local dashboard after login`, async ({ page, baseURL }) => {
    test.setTimeout(60_000);
    for (const destination of category.values) {
      await page.context().clearCookies();
      await page.goto(`/login?next=${encodeURIComponent(destination)}`);
      await submitLogin(page);
      await expect(page).toHaveURL(new URL("/dashboard", baseURL).href, { timeout: 15_000 });
    }
  });
}

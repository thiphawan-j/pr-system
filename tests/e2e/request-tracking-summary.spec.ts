import { expect, test } from "@playwright/test";
import { createRequestViaApi, credentials, postRequestAction, signIn, switchUser } from "./support";

test("tracking links preserve detail/history and distinguish a rejected PR", async ({ page }) => {
  await signIn(page);
  const request = await createRequestViaApi(page, { submit: true });
  await page.goto(request.url);
  const summary = page.getByTestId("request-tracking-summary");
  await expect(summary).toContainText(request.prNumber);
  await expect(summary.getByTestId("tracking-next-step")).toContainText(/รอผู้อนุมัติ|awaiting approver/i);
  await summary.locator('a[href="#pr-approval-history"]').click();
  await expect(page.locator("#pr-approval-history")).toBeInViewport();
  await switchUser(page, credentials.approver);
  expect((await postRequestAction(page, request.id, "approval", { action: "REJECTED", comment: "Tracking test rejection" })).status()).toBe(200);
  await page.goto(request.url);
  await expect(summary.getByTestId("tracking-next-step")).toContainText(/ถูกปฏิเสธ|request rejected/i);
  await expect(summary.locator("button,form")).toHaveCount(0);
});

test("tracking overview fits mobile and preserves anchors", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  const request = await createRequestViaApi(page);
  await page.goto(request.url);
  const summary = page.getByTestId("request-tracking-summary");
  await expect(summary).toBeVisible();
  await expect(summary.locator("section")).toHaveCount(4);
  expect(await page.locator("body").evaluate(el => el.scrollWidth)).toBeLessThanOrEqual(390);
  await summary.locator('a[href="#pr-receipt-history"]').click();
  await expect(page.locator("#pr-receipt-history")).toBeInViewport();
});

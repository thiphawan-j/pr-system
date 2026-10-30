import { expect, test, type Page, type Route } from "@playwright/test";

import { authenticate } from "./receipt-support";
import { credentials, uniqueValue } from "./support";

function gate() {
  let release!: () => void;
  let arrive!: () => void;
  return {
    held: new Promise<void>((resolve) => { release = resolve; }),
    arrived: new Promise<void>((resolve) => { arrive = resolve; }),
    release: () => release(),
    arrive: () => arrive(),
  };
}

const activity = (page: Page) => page.locator('[data-app-activity="status"]');

async function holdNavigation(page: Page, accepts: (url: URL) => boolean) {
  const pending = gate();
  await page.route("**/*", async (route) => {
    if (route.request().headers().rsc !== "1" || !accepts(new URL(route.request().url()))) return route.continue();
    pending.arrive();
    await pending.held;
    await route.continue();
  });
  return pending;
}

async function firstRequest(page: Page) {
  const response = await page.request.get("/api/purchase-requests?limit=1");
  expect(response.ok()).toBe(true);
  const result = await response.json() as { items: Array<{ id: string }> };
  expect(result.items.length, "The standard demo database must contain a PR for read-only loading tests").toBeGreaterThan(0);
  return result.items[0]!.id;
}

test("navigation shows progress until the destination is ready", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await authenticate(page, credentials.admin);
  // Warm the destination's dev compilation; the gate controls the delay under test.
  expect((await page.request.get("/reports")).ok()).toBe(true);
  await page.goto("/dashboard");
  const pending = await holdNavigation(page, (url) => url.pathname === "/reports");
  try {
    await page.getByRole("navigation", { name: /เมนูหลัก|main menu/i }).getByRole("link", { name: /^รายงาน$|^reports$/i }).click();
    await pending.arrived;
    await expect(activity(page)).toHaveAttribute("data-activity-kind", "navigation");
    await expect(activity(page)).toHaveCSS("opacity", "1");
    await expect(page.locator('[data-app-activity="progress"]')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("navigation-loading.png") });
  } finally { pending.release(); }
  await expect(page).toHaveURL(/\/reports$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/รายงาน|reports/i);
  await expect(activity(page)).toHaveCount(0);
});

test("GET filters keep query values and show pending feedback before results arrive", async ({ page }) => {
  await authenticate(page, credentials.admin);
  await page.goto("/purchase-requests");
  const query = uniqueValue("Loading filter");
  const pending = await holdNavigation(page, (url) => url.pathname === "/purchase-requests" && url.searchParams.get("query") === query);
  await page.locator("#query").fill(query);
  await page.locator("#department").selectOption("Operations");
  try {
    await page.getByRole("button", { name: /^ค้นหา$|^search$/i }).click();
    await pending.arrived;
    const busyButton = page.getByRole("button", { name: /กำลังโหลด|loading/i });
    await expect(busyButton).toBeDisabled();
    await expect(busyButton).toHaveAttribute("aria-busy", "true");
    await expect(activity(page)).toBeVisible();
  } finally { pending.release(); }
  await expect(page).toHaveURL((url) => url.searchParams.get("query") === query && url.searchParams.get("department") === "Operations");
  await expect(activity(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^ค้นหา$|^search$/i })).toBeEnabled();
});

test("saving a comment prevents duplicate requests, preserves text on failure, and recovers after a network error", async ({ page }) => {
  await authenticate(page, credentials.admin);
  const id = await firstRequest(page);
  await page.goto(`/purchase-requests/${id}`);
  const pending = gate();
  let calls = 0;
  await page.route(`**/api/purchase-requests/${id}/comments`, async (route) => {
    calls++;
    if (calls === 1) {
      pending.arrive();
      await pending.held;
      await route.fulfill({ status: 500, json: { error: "Loading test: save failed" } });
    } else await route.abort("failed");
  });
  const comment = uniqueValue("Preserved loading draft");
  await page.locator("#purchase-request-comment").fill(comment);
  try {
    await page.getByRole("button", { name: /^เพิ่มหมายเหตุ$|^add note$/i }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await pending.arrived;
    await expect(page.getByRole("button", { name: /กำลังบันทึก|saving/i })).toBeDisabled();
    await expect(page.locator('[data-busy-spinner]')).toBeVisible();
    await expect(activity(page)).toHaveAttribute("data-activity-kind", "process");
    expect(calls).toBe(1);
  } finally { pending.release(); }
  const add = page.getByRole("button", { name: /^เพิ่มหมายเหตุ$|^add note$/i });
  await expect(add).toBeEnabled();
  await expect(page.locator("#purchase-request-comment")).toHaveValue(comment);
  await expect(activity(page)).toHaveCount(0);
  await add.click();
  await expect(add).toBeEnabled();
  await expect(activity(page)).toHaveCount(0);
  await expect(page.locator("#purchase-request-comment")).toHaveValue(comment);
  expect(calls).toBe(2);
});

test("saving a new PR restores the form after a failed request without creating a document", async ({ page }) => {
  await authenticate(page, credentials.admin);
  await page.goto("/purchase-requests/new");
  await page.getByRole("button", { name: /บันทึกร่าง|save draft/i }).click();
  await expect(page.locator("p.text-destructive").filter({ hasText: /กรุณาระบุชื่อสินค้า|item name/i })).toBeVisible();
  const reason = uniqueValue("Loading request draft");
  await page.locator("#reason").fill(reason);
  await page.locator('input[name="items.0.itemName"]').fill("Preserved item draft");
  const pending = gate();
  let calls = 0;
  await page.route("**/api/purchase-requests", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    calls++;
    pending.arrive();
    await pending.held;
    await route.fulfill({ status: 500, json: { error: "Loading test: create failed" } });
  });
  try {
    await page.getByRole("button", { name: /บันทึกร่าง|save draft/i }).click();
    await pending.arrived;
    await expect(page.getByRole("button", { name: /กำลังบันทึก|saving/i })).toHaveAttribute("aria-busy", "true");
    await expect(page.locator("#reason")).toBeDisabled();
    await expect(activity(page)).toBeVisible();
    expect(calls).toBe(1);
  } finally { pending.release(); }
  await expect(page.getByRole("button", { name: /บันทึกร่าง|save draft/i })).toBeEnabled();
  await expect(page.locator("#reason")).toHaveValue(reason);
  await expect(page.locator('input[name="items.0.itemName"]')).toHaveValue("Preserved item draft");
  await expect(activity(page)).toHaveCount(0);
});

test("the selected PR save button remains busy until its destination loads", async ({ page }) => {
  await authenticate(page, credentials.admin);
  const id = await firstRequest(page);
  await page.goto("/purchase-requests/new");
  const pending = await holdNavigation(page, (url) => url.pathname === `/purchase-requests/${id}`);
  await page.route("**/api/purchase-requests", (route) => route.request().method() === "POST"
    ? route.fulfill({ json: { id } }) : route.continue());
  await page.locator("#reason").fill("Mocked PR save navigates without changing local data");
  await page.locator('input[name="items.0.itemName"]').fill("Mocked save hand-off");
  try {
    await page.getByRole("button", { name: /บันทึกร่าง|save draft/i }).click();
    await pending.arrived;
    const save = page.getByRole("button", { name: /กำลังบันทึก|saving/i });
    await expect(save).toHaveAttribute("aria-busy", "true");
    await expect(save).toBeDisabled();
    await expect(activity(page)).toBeVisible();
  } finally { pending.release(); }
  await expect(page).toHaveURL(new RegExp(`/purchase-requests/${id}$`));
  await expect(activity(page)).toHaveCount(0);
});

test("mutation feedback remains active while the same page refreshes", async ({ page }) => {
  await authenticate(page, credentials.admin);
  const id = await firstRequest(page);
  await page.goto(`/purchase-requests/${id}`);
  const pending = await holdNavigation(page, (url) => url.pathname === `/purchase-requests/${id}`);
  // A successful mock tests the UI hand-off without adding a real comment.
  await page.route(`**/api/purchase-requests/${id}/comments`, (route) => route.fulfill({ json: { ok: true } }));
  await page.locator("#purchase-request-comment").fill("Mocked successful save followed by a slow refresh");
  try {
    await page.getByRole("button", { name: /^เพิ่มหมายเหตุ$|^add note$/i }).click();
    await pending.arrived;
    await expect(activity(page)).toBeVisible();
    await expect(page.getByRole("button", { name: /กำลังบันทึก|saving/i })).toBeDisabled();
  } finally { pending.release(); }
  await expect(activity(page)).toHaveCount(0);
  await expect(page.locator("#purchase-request-comment")).toBeEnabled();
});

test("concurrent downloads retain feedback until both files are ready, preserve names, and hide feedback in print", async ({ page }, testInfo) => {
  await authenticate(page, credentials.admin);
  await page.goto("/reports");
  const excelGate = gate();
  const pdfGate = gate();
  let excelCalls = 0;
  const excel = page.locator('a[href^="/api/reports/export/excel"]');
  const pdf = page.locator('a[href^="/api/reports/export/pdf"]');
  await page.route("**/api/reports/export/excel?*", async (route) => {
    excelCalls++;
    excelGate.arrive();
    await excelGate.held;
    await route.fulfill({ contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers: { "Content-Disposition": 'attachment; filename="loading-one.xlsx"' }, body: "loading test file" });
  });
  await page.route("**/api/reports/export/pdf?*", async (route) => {
    pdfGate.arrive();
    await pdfGate.held;
    await route.fulfill({ contentType: "application/pdf", headers: { "Content-Disposition": "attachment; filename*=UTF-8''loading-two.pdf" }, body: "%PDF-1.4 loading test file" });
  });
  try {
    await excel.click();
    await excelGate.arrived;
    await excel.evaluate((link: HTMLAnchorElement) => link.click());
    await pdf.click();
    await pdfGate.arrived;
    await expect(excel).toHaveAttribute("aria-busy", "true");
    await expect(pdf).toHaveAttribute("aria-busy", "true");
    await expect(activity(page)).toHaveAttribute("data-activity-kind", "download");
    await expect(activity(page)).toHaveCSS("opacity", "1");
    expect(excelCalls).toBe(1);
    await page.screenshot({ path: testInfo.outputPath("download-loading.png") });
    await page.setViewportSize({ width: 375, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.screenshot({ path: testInfo.outputPath("download-loading-mobile.png") });
    await page.emulateMedia({ media: "print" });
    await expect(activity(page)).toBeHidden();
    await page.emulateMedia({ media: "screen", reducedMotion: "reduce" });
    await expect(page.locator(".app-activity-progress")).toHaveCSS("animation-name", "none");
    const firstDownload = page.waitForEvent("download");
    excelGate.release();
    expect((await firstDownload).suggestedFilename()).toBe("loading-one.xlsx");
    await expect(excel).not.toHaveAttribute("aria-busy", "true");
    await expect(activity(page)).toHaveAttribute("data-activity-kind", "download");
    const secondDownload = page.waitForEvent("download");
    pdfGate.release();
    expect((await secondDownload).suggestedFilename()).toBe("loading-two.pdf");
  } finally { excelGate.release(); pdfGate.release(); }
  await expect(activity(page)).toHaveCount(0);
  await expect(pdf).not.toHaveAttribute("aria-busy", "true");
});

test("download errors restore the link and show an error instead of leaving a spinner", async ({ page }) => {
  await authenticate(page, credentials.admin);
  await page.goto("/reports");
  const link = page.locator('a[href^="/api/reports/export/pdf"]');
  await page.route("**/api/reports/export/pdf?*", (route) => route.fulfill({ status: 500, json: { error: "Loading test: download failed" } }));
  await link.click();
  await expect(page.locator('[data-sonner-toast]')).toContainText("Loading test: download failed");
  await expect(activity(page)).toHaveCount(0);
  await expect(link).not.toHaveAttribute("aria-disabled", "true");
});

test("a network error during login clears loading and leaves entered credentials available for retry", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#identifier").fill("admin");
  await page.locator("#password").fill("Passw0rd!");
  const pending = gate();
  await page.route("**/api/auth/login", async (route: Route) => { pending.arrive(); await pending.held; await route.abort("failed"); });
  try {
    await page.getByRole("button", { name: /เข้าสู่ระบบ|sign in/i }).click();
    await pending.arrived;
    await expect(page.getByRole("button", { name: /กำลังเข้าสู่ระบบ|signing in/i })).toBeDisabled();
    await expect(activity(page)).toHaveAttribute("data-activity-kind", "process");
  } finally { pending.release(); }
  await expect(page.getByRole("button", { name: /^เข้าสู่ระบบ$|^sign in$/i })).toBeEnabled();
  await expect(page.locator("#identifier")).toHaveValue("admin");
  await expect(page.locator("#password")).toHaveValue("Passw0rd!");
  await expect(activity(page)).toHaveCount(0);
});

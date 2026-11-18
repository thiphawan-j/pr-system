import { expect, test, type Page } from "@playwright/test";
import { createRequestViaApi, signIn } from "./support";

async function cancelTraversal(page: Page, direction: "back" | "forward") {
  // Waiting for a load after cancellation is incorrect: the current document stays.
  // Explicitly await the native dialog instead, then assert its resulting state.
  const dismissed = page.waitForEvent("dialog").then(async dialog => {
    expect(dialog.type()).toBe("beforeunload");
    await dialog.dismiss();
  });
  await page.evaluate(direction => { setTimeout(() => window.history[direction](), 0); }, direction);
  await dismissed;
}

test("every known create/edit entry opens a new document", async ({ page }) => {
  await signIn(page);
  const draft = await createRequestViaApi(page);
  const paths = [
    ["/dashboard", 'main a[href="/purchase-requests/new"]'],
    ["/dashboard", 'nav a[href="/purchase-requests/new"]'],
    ["/dashboard", '[data-work-group="drafts"] a[href$="/edit"]'],
    ["/purchase-requests", `a[href="${draft.url}/edit"]`],
    [draft.url, `a[href="${draft.url}/edit"]`],
  ];
  for (const [source, selector] of paths) {
    await page.goto(source);
    await page.evaluate(() => { document.documentElement.dataset.documentMarker = "old"; });
    await page.locator(selector).filter({ visible: true }).first().click();
    await expect(page.locator("#reason")).toBeVisible();
    await expect(page.locator("html")).not.toHaveAttribute("data-document-marker", "old");
  }
});

for (const width of [1280, 390]) {
test(`Back and Forward cancellations retain edits and attachments at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await signIn(page);
  await page.locator('main a[href="/purchase-requests/new"]').click();
  await page.locator("#reason").click(); // Sticky activation belongs to this new document.
  await page.locator("#reason").fill("Keep my unsaved text");
  await page.locator("#attachments").setInputFiles({ name: "quote.txt", mimeType: "text/plain", buffer: Buffer.from("example quote") });
  for (let attempt = 0; attempt < 2; attempt++) {
    await cancelTraversal(page, "back");
    await expect(page).toHaveURL(/\/purchase-requests\/new$/);
    await expect(page.locator("#reason")).toHaveValue("Keep my unsaved text");
    await expect(page.getByText("quote.txt", { exact: true })).toBeVisible();
  }
  page.once("dialog", dialog => dialog.accept());
  await page.evaluate(() => { window.location.assign("/dashboard"); });
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goBack();
  await expect(page.locator("#reason")).toBeVisible();
  await page.locator("#reason").click();
  await page.locator("#reason").fill("Forward must also protect me");
  await page.locator("#attachments").setInputFiles({ name: "forward.txt", mimeType: "text/plain", buffer: Buffer.from("example quote") });
  for (let attempt = 0; attempt < 2; attempt++) {
    await cancelTraversal(page, "forward");
    await expect(page).toHaveURL(/\/purchase-requests\/new$/);
    await expect(page.locator("#reason")).toHaveValue("Forward must also protect me");
    await expect(page.getByText("forward.txt", { exact: true })).toBeVisible();
  }
  page.once("dialog", dialog => dialog.accept());
  await page.goForward();
  await expect(page).toHaveURL(/\/dashboard$/);
});
}

import { expect, test } from "@playwright/test";
import { createRequestViaApi, credentials, signIn, switchUser } from "./support";

const roleGroups = [
  { role: "employee", groups: ["drafts", "returned", "receipts"] },
  { role: "approver", groups: ["drafts", "returned", "approval", "receipts"] },
  { role: "purchasing", groups: ["drafts", "returned", "purchasing", "receipts"] },
  { role: "admin", groups: ["drafts", "returned", "approval", "purchasing", "receipts"] },
  { role: "management", groups: ["drafts", "returned", "approval", "receipts"] },
] as const;

for (const { role, groups } of roleGroups) {
  test(`${role} sees only appropriate work groups with bounded detail links`, async ({ page }) => {
    await signIn(page, credentials[role]);
    const queue = page.locator("[data-personal-work-queue]");
    await expect(queue).toBeVisible();
    await expect(queue.locator("[data-work-group]")).toHaveCount(groups.length);
    for (const group of groups) {
      const section = queue.locator(`[data-work-group="${group}"]`);
      await expect(section).toBeVisible();
      expect(await section.locator("li").count()).toBeLessThanOrEqual(5);
      // Queue offers navigation, not approval or receiving mutations.
      await expect(section.locator("button, form")).toHaveCount(0);
    }
  });
}

test("employee queue does not expose another employee's private draft", async ({ page }) => {
  await signIn(page, credentials.employee2);
  const otherDraft = await createRequestViaApi(page);
  await switchUser(page, credentials.employee);
  const queue = page.locator("[data-personal-work-queue]");
  await expect(queue).toBeVisible();
  await expect(queue.locator(`a[href*="${otherDraft.id}"]`)).toHaveCount(0);
  await expect(queue.getByText(otherDraft.prNumber, { exact: false })).toHaveCount(0);
  const response = await page.request.get(`/api/purchase-requests/${otherDraft.id}`);
  expect([403, 404]).toContain(response.status());
});

test("personal work queue stays inside the mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, credentials.employee);
  await expect(page.locator("[data-personal-work-queue]")).toBeVisible();
  expect(await page.locator("body").evaluate(body => body.scrollWidth)).toBeLessThanOrEqual(390);
});


test("own drafts paginate independently and preserve browser back navigation", async ({ page }) => {
  await signIn(page, credentials.employee);
  // Create only through the existing authenticated API against E2E fixtures.
  for (let i = 0; i < 6; i++) await createRequestViaApi(page);
  await page.goto("/dashboard?wq_receipts=2");
  const drafts = page.locator('[data-work-group="drafts"]');
  await expect(drafts.locator("li")).toHaveCount(5);
  const firstPageIds = await drafts.locator("li a").evaluateAll(links => links.map(link => link.getAttribute("href")));
  await drafts.locator('a[rel="next"]').click();
  await expect(page).toHaveURL(/wq_drafts=2/);
  await expect(drafts.locator('a[rel="prev"]')).toBeVisible();
  const nextPageIds = await drafts.locator("li a").evaluateAll(links => links.map(link => link.getAttribute("href")));
  expect(nextPageIds.length).toBeGreaterThan(0);
  expect(nextPageIds.some(id => firstPageIds.includes(id))).toBe(false);
  await page.goBack();
  await expect(drafts.locator("li a").first()).toHaveAttribute("href", firstPageIds[0]!);
  await page.goto("/dashboard?wq_drafts=-1&wq_approval=999");
  await expect(drafts.locator("li a").first()).toHaveAttribute("href", firstPageIds[0]!);
  await expect(page.locator('[data-work-group="approval"]')).toHaveCount(0);
});

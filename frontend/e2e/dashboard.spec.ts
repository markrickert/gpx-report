import { test, expect } from "@playwright/test";

// Read-only: only ever looks at whatever real activities the live
// deployment already has (per docs/TODO.md, this suite must never mutate
// real data) — no fixture activity is created or required here.
test.describe("Dashboard", () => {
  test("loads the activity list with the summary stats, no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto("/");

    await expect(page.locator(".summary-grid")).toBeVisible();
    await expect(page.locator(".summary-grid .summary-value").first()).not.toHaveText("");

    const items = page.locator(".activity-list li");
    await expect(items.first()).toBeVisible();
    expect(await items.count()).toBeGreaterThan(0);

    // Nav should reflect the current route.
    await expect(page.locator("nav a.active")).toHaveText("Dashboard");

    expect(errors, `console/page errors: ${errors.join("\n")}`).toEqual([]);
  });
});

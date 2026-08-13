import { test, expect } from "@playwright/test";

// Read-only: Stats is an aggregate/read-only page (no mutations anywhere on
// it), so it's safe to load directly against the real, live dataset.
test.describe("Stats page", () => {
  test("renders without error, with heatmap calendar and per-type table", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto("/stats");

    await expect(page.locator("h1")).toHaveText("Stats");
    // The heatmap/volume/scatter section is gated behind its own
    // activities(limit: 1000) query (see Stats.tsx), a noticeably heavier
    // payload than the page's other queries on a 500+-activity deployment
    // — give it more room than the default expect timeout.
    await expect(page.locator(".calendar-heatmap-grid")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".stats-table").first()).toBeVisible();
    await expect(page.locator("nav a.active")).toHaveText("Stats");

    expect(errors, `console/page errors: ${errors.join("\n")}`).toEqual([]);
  });
});

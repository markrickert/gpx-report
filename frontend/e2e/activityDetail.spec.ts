import { test, expect } from "@playwright/test";
import { graphql } from "./gpxFixture";

// Read-only: opens a real existing activity (picked live off the API, never
// hardcoded) purely to view it — never edits/trims/deletes it. The
// mutation-covering flow lives entirely in editTrimDelete.spec.ts against
// its own disposable fixture activity.
test.describe("ActivityDetail (read-only, real activity)", () => {
  let activityId: string;

  test.beforeAll(async () => {
    const data = await graphql<{ activities: { id: string }[] }>(`
      query {
        activities(limit: 1) {
          id
        }
      }
    `);
    if (data.activities.length === 0) {
      test.skip(true, "no real activities exist on this deployment to view read-only");
    }
    activityId = data.activities[0].id;
  });

  test("opens from the Dashboard and renders map, stats tiles, and elevation chart", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto("/");
    const firstActivityLink = page.locator(".activity-list-link").first();
    await expect(firstActivityLink).toBeVisible();
    await firstActivityLink.click();

    await expect(page).toHaveURL(/\/activities\/\d+/);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator(".metrics-grid .metric-tile").first()).toBeVisible();
    await expect(page.locator(".activity-map")).toBeVisible();
    await expect(page.locator(".elevation-chart").first()).toBeVisible();

    expect(errors, `console/page errors: ${errors.join("\n")}`).toEqual([]);
  });

  test("activity navigated to directly by id renders fully", async ({ page }) => {
    await page.goto(`/activities/${activityId}`);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator(".metrics-grid .metric-tile").first()).toBeVisible();
    await expect(page.locator(".activity-map")).toBeVisible();
    await expect(page.locator(".elevation-chart").first()).toBeVisible();
  });
});

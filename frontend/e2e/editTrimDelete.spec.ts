import { access } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  GPX_DIR,
  buildFixtureGpx,
  cleanupFixture,
  graphql,
  waitForIngest,
  writeFixtureFile,
} from "./gpxFixture";

// The one flow in this suite that mutates anything. Everything here runs
// against a single disposable fixture activity created fresh in
// beforeAll and destroyed in afterAll (which Playwright still runs if a
// test in this file fails/throws) — never against any of the 500+ real
// activities on this deployment. See gpxFixture.ts for the full teardown
// strategy (DB row + source file + writer.js's _backups/ copies, each
// step independently best-effort so a partial failure can't skip the rest).
test.describe.configure({ mode: "serial" });

test.describe("Edit / trim / delete flow (disposable fixture activity)", () => {
  const runId = randomUUID();
  const filename = `e2e-fixture-${runId}.gpx`;
  const originalTitle = `E2E Fixture ${runId}`;
  const updatedTitle = `E2E Fixture ${runId} (edited)`;
  let activityId: string | null = null;

  test.beforeAll(async () => {
    await writeFixtureFile(filename, buildFixtureGpx(originalTitle));
    activityId = await waitForIngest(originalTitle);
  });

  test.afterAll(async () => {
    await cleanupFixture(filename, activityId);
  });

  test("edit title and activity type", async ({ page }) => {
    await page.goto(`/activities/${activityId}`);
    await expect(page.locator("h1")).toContainText(originalTitle);

    // Two separate edit/save round trips rather than changing both fields
    // in one Save click: ActivityHeader.save() fires updateActivityTitle
    // and updateActivityType concurrently via Promise.all when both
    // changed, and both mutations independently read-modify-write the same
    // GPX file through processFile() — whichever finishes last can
    // silently stump the other's change back to its pre-edit on-disk
    // value. Reproduced live against this exact fixture while building
    // this suite (a genuine app race condition, not a test bug); flagged
    // in docs/TODO.md rather than fixed here, out of scope for this task.
    // Splitting the save avoids relying on that racy path.
    await page.getByRole("button", { name: "Edit activity" }).click();
    let editRow = page.locator(".title-edit-row");
    await expect(editRow).toBeVisible();
    await editRow.locator("input").fill(updatedTitle);
    await editRow.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("h1")).toContainText(updatedTitle);

    await page.getByRole("button", { name: "Edit activity" }).click();
    editRow = page.locator(".title-edit-row");
    await expect(editRow).toBeVisible();
    await editRow.locator("select").selectOption("Cycling");
    await editRow.getByRole("button", { name: "Save", exact: true }).click();
    // The type badge is always the last .activity-type-badge in the header
    // — any PR badges (matchedRecords()) render first, in a separate <p>
    // above it, and are vanishingly unlikely for a ~2-minute synthetic
    // fixture track anyway.
    await expect(page.locator(".activity-type-badge").last()).toContainText("Cycling");

    const data = await graphql<{ activity: { title: string; activityType: string } }>(
      `
        query ($id: ID!) {
          activity(id: $id) {
            title
            activityType
          }
        }
      `,
      { id: activityId },
    );
    expect(data.activity.title).toBe(updatedTitle);
    expect(data.activity.activityType).toBe("Cycling");
  });

  test("trim via the auto-suggested crop", async ({ page }) => {
    const before = await graphql<{ activity: { route: { coordinates: unknown[] } } }>(
      `
        query ($id: ID!) {
          activity(id: $id) {
            route {
              coordinates
            }
          }
        }
      `,
      { id: activityId },
    );
    const pointsBefore = before.activity.route.coordinates.length;

    page.once("dialog", (dialog) => dialog.accept());

    await page.goto(`/activities/${activityId}`);
    await page.getByRole("button", { name: "Edit activity" }).click();

    // The fixture's ~40s stationary lead-in (see gpxFixture.ts) makes
    // ActivityDetail.tsx's suggestTrimRange() pre-select a non-full crop as
    // soon as edit mode opens — the "Trim & Save" button is enabled without
    // any drag gesture needed, itself exercising the shipped
    // auto-suggested-crop feature rather than a synthetic shortcut.
    const trimButton = page.getByRole("button", { name: "Trim & Save" });
    await expect(trimButton).toBeEnabled();
    await trimButton.click();

    await expect(page.getByRole("button", { name: "Edit activity" })).toBeVisible();

    await expect
      .poll(
        async () => {
          const after = await graphql<{ activity: { route: { coordinates: unknown[] } } }>(
            `
              query ($id: ID!) {
                activity(id: $id) {
                  route {
                    coordinates
                  }
                }
              }
            `,
            { id: activityId },
          );
          return after.activity.route.coordinates.length;
        },
        { timeout: 15_000 },
      )
      .toBeLessThan(pointsBefore);
  });

  test("delete removes the DB row and source file", async ({ page }) => {
    page.once("dialog", (dialog) => dialog.accept());

    await page.goto(`/activities/${activityId}`);
    await page.locator(".delete-activity-button").click();

    await expect(page).toHaveURL(/\/$/);

    const data = await graphql<{ activity: unknown }>(
      `
        query ($id: ID!) {
          activity(id: $id) {
            id
          }
        }
      `,
      {
        id: activityId,
      },
    );
    expect(data.activity).toBeNull();

    // deleteActivity's own responsibility is the source file; confirmed
    // here rather than assumed, since cleanupFixture's own unlink in
    // afterAll would otherwise silently paper over a resolver regression.
    await expect(access(path.join(GPX_DIR, filename))).rejects.toThrow();

    // This test just did cleanupFixture's job itself — null it out so
    // afterAll's deleteActivity call is a harmless no-op instead of an
    // avoidable "activity not found" error.
    activityId = null;
  });
});

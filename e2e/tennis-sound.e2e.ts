import { expect, test } from "@playwright/test";
import { keysIfAsked, noHorizontalScroll, soundToggleWorks } from "./sound-flow.ts";

// Task 19: tennis's sound button and its crowd, at both viewports. The crowd
// reacts by side after a point, worked out on this screen from the
// snapshots: the point's winner's side cheers and the loser's side awws.

test("the home screen has the sound button beside the profile, one only, and it works", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Profile: / })).toBeVisible();
  await soundToggleWorks(page);
  // the setting is remembered per browser
  await page.locator("button[data-action=sound]").click();
  await page.getByRole("group", { name: "Sound settings" }).getByRole("checkbox", { name: /Music/ }).uncheck();
  await page.reload();
  await page.locator("button[data-action=sound]").click();
  await expect(page.getByRole("group", { name: "Sound settings" }).getByRole("checkbox", { name: /Music/ })).not.toBeChecked();
});

test("tennis practice: the sound button is in the HUD and reachable, and the stands react to a point by side", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.getByRole("button", { name: /practice vs bot/i }).click();
  await keysIfAsked(page);
  // the home screen's button went with the menu: only the game's is left
  await soundToggleWorks(page);
  const canvas = page.locator("canvas");
  // the first point (not a fault): one side cheers and the other goes aww, never both the same
  await expect.poll(async () => (await canvas.getAttribute("data-crowd0")) ?? "", { timeout: 60_000 }).not.toBe("");
  const sides = [await canvas.getAttribute("data-crowd0"), await canvas.getAttribute("data-crowd1")].map((s) => (s ?? "").split(":")[0]).sort();
  expect(sides).toEqual(["aww", "cheer"]);
  expect(await noHorizontalScroll(page)).toBe(true);
});

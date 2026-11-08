import { expect, test } from "@playwright/test";
import { keysIfAsked, soundToggleWorks } from "./sound-flow.ts";

// Task 19: boxing's sound button in the HUD, at both viewports.

test("boxing practice: the sound button is in the HUD, reachable, and works", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Boxing/ }).click();
  await expect(page.locator("#options-title")).toHaveText("Boxing");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await keysIfAsked(page);
  await expect.poll(async () => Number(await page.locator(".boxing canvas").getAttribute("data-frames"))).toBeGreaterThan(5);
  await soundToggleWorks(page);
});

import { expect, test } from "@playwright/test";
import type { Browser, Page, TestInfo } from "@playwright/test";
import { openLeaderboardFromMenu, openProfileDialog, signInDemo, useKeyboard } from "./flow.ts";

// Task 7: the leaderboard (a tab per sport, your rank, history) and the
// host's rated switch in the ready panel, at both viewports.

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function newPage(browser: Browser, page: Page, testInfo: TestInfo): Promise<Page> {
  const mobile = testInfo.project.name === "mobile";
  const ctx = await browser.newContext({ viewport: page.viewportSize()!, isMobile: mobile, hasTouch: mobile });
  return ctx.newPage();
}

test("the leaderboard opens from the home screen: a tab per sport, keyboard, fits the screen, and closes", async ({ page }) => {
  await page.goto("/");
  const dialog = await openLeaderboardFromMenu(page);
  const tabs = dialog.getByRole("tab");
  await expect(tabs.first()).toHaveText("Tennis");
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByRole("table")).toBeVisible();
  await expect(dialog.getByText(/starts at 1000/)).toBeVisible();
  // a guest is told how to get on the board
  await expect(dialog.getByText(/sign in with a passkey and play a rated match/i)).toBeVisible();
  await expect(dialog.getByRole("cell", { name: /^Demo (One|Two)/ })).toHaveCount(0);

  const box = (await dialog.boundingBox())!;
  const v = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(v.width);
  expect(box.y + box.height).toBeLessThanOrEqual(v.height);
  expect(await noHorizontalScroll(page)).toBe(true);

  // one tab per registered sport (tennis, archery, track, boxing...): arrows move between them and wrap.
  // The count follows the registry, so adding a game doesn't break this.
  const n = await tabs.count();
  expect(n).toBeGreaterThanOrEqual(3);
  await tabs.first().focus();
  for (let i = 1; i < n; i++) {
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(i)).toBeFocused();
    await expect(tabs.nth(i)).toHaveAttribute("aria-selected", "true");
  }
  await page.keyboard.press("ArrowRight");
  await expect(tabs.first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("a demo account sees its own rating and rank in the profile and on the board, but isn't listed", async ({ page }) => {
  await page.goto("/");
  await signInDemo(page, "One");
  const profile = await openProfileDialog(page);
  await expect(profile.getByText(/Tennis: rating \d+/)).toBeVisible();
  await expect(profile.getByText(/Longest rally: \d+ shots/)).toBeVisible();
  await profile.getByRole("button", { name: "Close profile" }).click();
  const dialog = await openLeaderboardFromMenu(page);
  await expect(dialog.getByRole("cell", { name: /^Demo One/ })).toHaveCount(0);
});

test("the host's rated switch: a guest seat makes it unavailable and says why", async ({ page, browser }, testInfo) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await signInDemo(page, "One");
  await page.getByRole("button", { name: /create a room/i }).click();
  await expect(page).toHaveURL(/#\/room\/[A-Z]{4}$/, { timeout: 15_000 });
  // the webcam is the default (task 15): the keyboard way past the setup shows the panel
  await useKeyboard(page);
  const panel = page.getByRole("region", { name: /match setup/i });
  const rated = panel.getByRole("switch", { name: "Rated match" });
  await expect(rated).toBeDisabled();
  await expect(panel.getByText(/rated needs two signed-in players/i)).toBeVisible();

  // a guest joins: still unavailable, with the reason
  const guest = await newPage(browser, page, testInfo);
  await guest.goto(page.url());
  await useKeyboard(guest);
  await expect(panel.getByText(/a guest is playing/i)).toBeVisible();
  await expect(rated).toBeDisabled();
  await expect(guest.getByRole("region", { name: /match setup/i }).getByRole("switch", { name: "Rated match" })).toBeDisabled();
  // the host's own rating shows by their seat
  await expect(panel.locator(".rp-rating")).toHaveCount(1);
  expect(await noHorizontalScroll(page)).toBe(true);
  // close the second browser: several 3D pages left open starve the next test's frame rate
  await guest.context().close();
});

test("two accounts: the host turns rated on, it clears ready, and the joiner sees it", async ({ page, browser }, testInfo) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await signInDemo(page, "One");
  await page.getByRole("button", { name: /create a room/i }).click();
  await expect(page).toHaveURL(/#\/room\/[A-Z]{4}$/, { timeout: 15_000 });
  await useKeyboard(page);

  const other = await newPage(browser, page, testInfo);
  await other.goto("/");
  await signInDemo(other, "Two");
  await other.goto("about:blank");
  await other.goto(page.url());
  await useKeyboard(other);

  const panel = page.getByRole("region", { name: /match setup/i });
  const otherPanel = other.getByRole("region", { name: /match setup/i });
  await expect(otherPanel.getByRole("heading")).toHaveText(/ready up/i, { timeout: 15_000 });
  await otherPanel.getByRole("button", { name: "I'm ready" }).click();
  await expect(panel.locator('[data-seat="1"]')).toHaveAttribute("data-ready", "true");

  const rated = panel.getByRole("switch", { name: "Rated match" });
  await expect(rated).toBeEnabled();
  await rated.check();
  await expect(otherPanel.getByText(/rated: the result changes both players' ratings/i)).toBeVisible();
  await expect(otherPanel.getByRole("switch", { name: "Rated match" })).toBeChecked();
  await expect(otherPanel.getByRole("switch", { name: "Rated match" })).toBeDisabled();
  // the change cleared the joiner's ready
  await expect(panel.locator('[data-seat="1"]')).toHaveAttribute("data-ready", "false");
  await expect(panel.locator(".rp-rating")).toHaveCount(2);
  await other.context().close();
});

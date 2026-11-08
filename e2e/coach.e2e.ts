import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { useKeyboard } from "./flow.ts";

// The practice coach for boxing and track (user, 2026-11-09): a short card in
// the HUD that names a move, draws it and ticks it off. At both viewports it
// must fit on screen and never cover the buttons.

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function open(page: Page, game: "boxing" | "track", practiceName: string) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem("wl_coach_off_boxing");
      localStorage.removeItem("wl_coach_off_track");
    } catch {
      /* ignore */
    }
  });
  await page.goto("/");
  await page.locator(`.sport[data-sport="${game}"]`).click();
  await page.getByRole("button", { name: practiceName, exact: true }).click();
  await useKeyboard(page);
  await expect(page.locator(".practice-coach")).toBeVisible();
}

async function fits(page: Page) {
  const v = page.viewportSize()!;
  const c = (await page.locator(".practice-coach").boundingBox())!;
  expect(c.x).toBeGreaterThanOrEqual(0);
  expect(c.x + c.width).toBeLessThanOrEqual(v.width);
  expect(c.y + c.height).toBeLessThanOrEqual(v.height);
  // never on top of the Leave button
  const l = (await page.locator('.hud [data-action="leave"]').boundingBox())!;
  const overlap = c.x < l.x + l.width && l.x < c.x + c.width && c.y < l.y + l.height && l.y < c.y + c.height;
  expect(overlap, "coach overlaps Leave").toBe(false);
  expect(await noHorizontalScroll(page)).toBe(true);
}

test("boxing: the coach shows a picture and the first move, and fits", async ({ page }) => {
  await open(page, "boxing", "Practice");
  await expect(page.locator(".practice-coach")).toContainText(/1 of 4: Jab the head/);
  await expect(page.locator(".practice-coach svg")).toBeVisible();
  await fits(page);
});

test("boxing: a head jab ticks the first step, and the coach goes on to the body jab", async ({ page }) => {
  await open(page, "boxing", "Practice");
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("j");
    await page.waitForTimeout(260);
  }
  await expect(page.locator(".practice-coach")).toContainText(/2 of 4: Jab the body/);
});

test("boxing: Skip coach hides it, and it stays hidden next time", async ({ page }) => {
  await open(page, "boxing", "Practice");
  await page.getByRole("button", { name: /skip coach/i }).click();
  await expect(page.locator(".practice-coach")).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("wl_coach_off_boxing"))).toBe("1");
});

test("track: the coach asks for steps, and A then D ticks them off", async ({ page }) => {
  await open(page, "track", "Practice");
  await expect(page.locator(".practice-coach")).toContainText(/Run on the spot/);
  await fits(page);
  // steps only count once the gun has gone
  await expect.poll(async () => Number(await page.locator(".track canvas").getAttribute("data-frames"))).toBeGreaterThan(5);
  await expect(page.locator(".track canvas")).toHaveAttribute("data-phase", "running", { timeout: 8_000 });
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("a");
    await page.waitForTimeout(120);
    await page.keyboard.press("d");
    await page.waitForTimeout(120);
  }
  await expect(page.locator(".practice-coach")).not.toContainText(/Run on the spot/, { timeout: 8000 });
});

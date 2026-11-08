import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { useKeyboard } from "./flow.ts";

// The aid turned off (user, 2026-11-08): with the trajectory aid off, nothing
// to aim with shows: no reticle ring on the opponent's court, no single arc,
// and none of the stroke messages ("Forehand", "Forehand · hard", "not sent").
// With it on the messages show, centred low, below the player and off them.

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function practice(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /practice vs bot/i }).click();
  await useKeyboard(page);
  await expect.poll(async () => Number(await page.locator("canvas").getAttribute("data-frames"))).toBeGreaterThan(5);
}

/** A box the view measured, "left,top,right,bottom" in CSS pixels. */
async function measured(page: Page, attr: string): Promise<Box> {
  await expect.poll(() => page.locator("canvas").getAttribute(attr)).toMatch(/^-?\d+,-?\d+,-?\d+,-?\d+$/);
  const [l, t, r, b] = (await page.locator("canvas").getAttribute(attr))!.split(",").map(Number);
  return { x: l, y: t, width: r - l, height: b - t };
}

/** Whether any shot message is on screen with something in it. */
const messageShowing = (page: Page) =>
  page.evaluate(() =>
    [".stroke", ".shot-label", ".aid-stance"].some((sel) =>
      [...document.querySelectorAll<HTMLElement>(sel)].some((el) => el.checkVisibility() && el.getBoundingClientRect().width > 0 && el.textContent!.trim() !== ""),
    ),
  );

test("aid off: no ring, no arc and no stroke message after a swing", async ({ page }) => {
  await practice(page);
  const canvas = page.locator("canvas");
  const toggle = page.getByRole("button", { name: /trajectory aid/i });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  // back to the game, so Space swings rather than pressing the toggle again
  await toggle.blur();
  // aiming by hand used to bring the ring (and, with a ball coming, the arc) back
  await page.keyboard.down("ArrowRight");
  for (const key of ["Digit3", "Space", "Digit1"]) {
    await page.keyboard.press(key);
    // watch the whole time a message would show (about a second)
    for (let i = 0; i < 6; i++) {
      expect(await messageShowing(page), `a stroke message after ${key}`).toBe(false);
      expect(await canvas.getAttribute("data-reticle")).toBe("");
      expect(await canvas.getAttribute("data-arc")).not.toBe("true");
      await page.waitForTimeout(150);
    }
  }
  await page.keyboard.up("ArrowRight");
  // the swings still went: the game runs without the aid
  await expect(page.locator(".aid-strength")).toHaveText("Chosen: light");
  // the bounce marks and the ball's trail stay
  await expect.poll(async () => Number(await canvas.getAttribute("data-bounces")), { timeout: 15_000 }).toBeGreaterThan(0);
});

test("aid on: the stroke message shows below the player, centred, off the player and the court", async ({ page }) => {
  await practice(page);
  await expect(page.locator("canvas")).toHaveAttribute("data-aid", "on");
  const player = await measured(page, "data-player");
  const court = await measured(page, "data-court");
  await page.keyboard.press("Digit3");
  const messages: Locator[] = [page.locator(".stroke"), page.locator(".shot-label")];
  // measured while both show (they hide after about a second), once the label's pop-in is done
  for (const m of messages) await expect(m).toBeVisible();
  await page.locator(".shot-label").evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const boxes = await Promise.all(messages.map(async (m) => (await m.boundingBox())!));
  const v = page.viewportSize()!;
  await expect(page.locator(".stroke")).toHaveText(/^Forehand|^Backhand/);
  for (const [i, box] of boxes.entries()) {
    const name = i === 0 ? "stroke line" : "shot label";
    expect(overlaps(box, player), `${name} covers the player`).toBe(false);
    expect(overlaps(box, court), `${name} covers the court`).toBe(false);
    // below the player, inside the screen, around the middle
    expect(box.y, `${name} is below the player`).toBeGreaterThanOrEqual(player.y + player.height * 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(v.height);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(v.width);
  }
  // the row of messages is centred on the screen
  const row = boxes.reduce((a, b) => ({ l: Math.min(a.l, b.x), r: Math.max(a.r, b.x + b.width) }), { l: Infinity, r: -Infinity });
  expect(Math.abs((row.l + row.r) / 2 - v.width / 2)).toBeLessThan(v.width * 0.05);
  // and clear of the aid's meter and the swing buttons
  for (const sel of [".aid", ".controls"]) {
    const o = (await page.locator(sel).boundingBox())!;
    for (const box of boxes) expect(overlaps(box, o), `a message covers ${sel}`).toBe(false);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

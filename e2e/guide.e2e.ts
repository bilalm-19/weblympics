import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { useKeyboard } from "./flow.ts";

// The how-to-play guide (task 35 item 3, built small; user, 2026-11-09): a "?"
// in every game's button row opens a panel of moves. At both viewports it must
// fit, show every move, and never cover the "?" button or the on-screen controls.

type Box = { x: number; y: number; width: number; height: number };
const overlap = (p: Box, q: Box) => p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
const games = ["tennis", "bowling", "basketball", "track", "archery", "boxing"];

async function openGame(page: Page, game: string) {
  await page.goto("/");
  await page.locator(`.sport[data-sport="${game}"]`).click();
  await page.getByRole("button", { name: /play vs bot|practice vs bot/i }).first().click();
  await useKeyboard(page);
  await expect(page.locator("canvas")).toBeVisible();
}

for (const game of games) {
  test(`${game}: the ? opens the moves, fits, covers nothing it shouldn't, and Escape closes it`, async ({ page }) => {
    await openGame(page, game);
    const button = page.locator('.hud [data-action="guide"]');
    await expect(button).toBeVisible();
    const panel = page.getByRole("dialog", { name: "How to play" });
    await expect(panel).toBeHidden();

    await button.click();
    await expect(panel).toBeVisible();
    expect(await panel.locator(".gd-move").count()).toBeGreaterThan(0);
    await expect(panel.locator(".gd-fig").first()).toBeVisible();

    const v = page.viewportSize()!;
    const p = (await panel.boundingBox())!;
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.x + p.width).toBeLessThanOrEqual(v.width);
    expect(p.y + p.height).toBeLessThanOrEqual(v.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // it never sits on the "?" itself, nor on the on-screen controls at the bottom
    const b = (await button.boundingBox())!;
    expect(overlap(p, b), "panel covers the ? button").toBe(false);
    const controls = page.locator(".controls:visible").first();
    if (await controls.count()) {
      const c = await controls.boundingBox();
      if (c) expect(overlap(p, c), "panel covers the controls").toBe(false);
    }

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  });
}

test("the guide opens in a room too, and sends nothing to the server", async ({ page }) => {
  const sent: string[] = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => sent.push(String(f.payload))));
  await page.goto("/");
  await page.getByRole("button", { name: /create/i }).first().click();
  await expect(page).toHaveURL(/#\/room\/[A-Z]{4}$/);
  await useKeyboard(page);
  const before = sent.length;
  await page.locator('.hud [data-action="guide"]').click();
  await expect(page.getByRole("dialog", { name: "How to play" })).toBeVisible();
  await page.waitForTimeout(400);
  const after = sent.slice(before).map((m) => {
    try {
      return JSON.parse(m).t as string;
    } catch {
      return "?";
    }
  });
  // only the page's own presence traffic, never a game or guide message
  expect(after.filter((t) => !["pong", "idle"].includes(t))).toEqual([]);
});

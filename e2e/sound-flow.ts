import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

// Task 19: the sound button, the same in every game's HUD and on the home
// screen. Shared by each game's `e2e/<name>-sound.e2e.ts`.

export const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function inside(page: Page, el: Locator, what: string): Promise<void> {
  const v = page.viewportSize()!;
  const b = (await el.boundingBox())!;
  expect(b, `${what} has a box`).not.toBeNull();
  expect(b.x, `${what} left`).toBeGreaterThanOrEqual(0);
  expect(b.y, `${what} top`).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width, `${what} right`).toBeLessThanOrEqual(v.width + 0.5);
  expect(b.y + b.height, `${what} bottom`).toBeLessThanOrEqual(v.height + 0.5);
}

/** Closes the camera setup if it opened (task 15), playing on keys. */
export async function keysIfAsked(page: Page): Promise<void> {
  const panel = page.getByRole("dialog", { name: /camera setup/i });
  const keys = panel.getByRole("button", { name: /use keyboard instead/i });
  try {
    await keys.waitFor({ state: "visible", timeout: 5_000 });
  } catch {
    return;
  }
  await keys.click();
  await expect(panel).toBeHidden();
}

/**
 * The sound button is on screen and a comfortable tap; its panel opens inside
 * the screen with Sound, Effects, Music and the volume; turning sound off
 * shows on the button; no horizontal scroll at any point.
 */
export async function soundToggleWorks(page: Page): Promise<void> {
  const button = page.locator("button[data-action=sound]");
  await expect(button).toHaveCount(1);
  await expect(button).toBeVisible();
  await inside(page, button, "sound button");
  const b = (await button.boundingBox())!;
  expect(b.width).toBeGreaterThanOrEqual(40);
  expect(b.height).toBeGreaterThanOrEqual(40);
  // a real click lands on it (nothing covers it)
  const hit = await button.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!top && el.contains(top);
  });
  expect(hit, "something covers the sound button").toBe(true);
  expect(await noHorizontalScroll(page)).toBe(true);

  await button.click();
  const panel = page.getByRole("group", { name: "Sound settings" });
  await expect(panel).toBeVisible();
  await inside(page, panel, "sound panel");
  for (const name of [/^Sound$/, /Effects/, /Music/]) await expect(panel.getByRole("checkbox", { name })).toBeVisible();
  await expect(panel.getByRole("slider", { name: "Volume" })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);

  const sound = panel.getByRole("checkbox", { name: /^Sound$/ });
  await expect(button).toHaveAttribute("data-state", "on");
  await sound.uncheck();
  await expect(button).toHaveAttribute("data-state", "off");
  await expect(panel.getByRole("checkbox", { name: /Effects/ })).toBeDisabled();
  await sound.check();
  await expect(button).toHaveAttribute("data-state", "on");
  // Escape closes it
  await sound.focus();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
}

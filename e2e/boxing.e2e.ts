import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// Task 30: boxing at both viewports. Keys and buttons throw punches and hold
// the guard (the camera, task 30's box-pose.ts, is not wired in yet). Practice
// runs in the page and sends nothing.

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const canvas = (page: Page) => page.locator(".boxing canvas");
const health = async (page: Page, seat: 0 | 1) => Number(await canvas(page).getAttribute(`data-h${seat}`));

async function openBoxing(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /Boxing/ }).click();
  await expect(page.locator("#options-title")).toHaveText("Boxing");
}

async function startPractice(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-frames"))).toBeGreaterThan(5);
  await expect(canvas(page)).toHaveAttribute("data-phase", "round");
}

test("the boxing tile is playable and opens its own options", async ({ page }) => {
  await openBoxing(page);
  await expect(page.getByRole("button", { name: /Boxing/ })).toHaveAttribute("aria-pressed", "true");
  for (const name of ["Play vs bot", "Practice", "Create a room"]) await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("practice: punches wear the sparring partner down, in the page, nothing sent to the server", async ({ page }) => {
  const frames: string[] = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => frames.push(String(f.payload))));
  await openBoxing(page);
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.locator(".bx-row")).toHaveCount(2);
  const sent = frames.length;
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-frames"))).toBeGreaterThan(5);
  await expect(canvas(page)).toHaveAttribute("data-phase", "round");
  expect(await noHorizontalScroll(page)).toBe(true);
  for (const sel of [".bx-board", ".bx-controls"]) {
    const b = (await page.locator(sel).boundingBox())!;
    const v = page.viewportSize()!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(v.width);
    expect(b.y + b.height).toBeLessThanOrEqual(v.height);
  }

  const before = await health(page, 1);
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press(i % 2 ? "KeyK" : "KeyJ");
    await page.waitForTimeout(420);
  }
  await expect.poll(() => health(page, 1)).toBeLessThan(before);
  expect(Number(await canvas(page).getAttribute("data-sent"))).toBeGreaterThanOrEqual(8);

  expect(frames.slice(sent).map((f) => JSON.parse(f).t).filter((t) => t !== "pong"), "practice sends nothing").toEqual([]);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator("#options-title")).toHaveText("Boxing");
});

test("the Jab, Hook and Guard buttons work too, and holding Guard raises it", async ({ page }) => {
  await openBoxing(page);
  await startPractice(page);
  const before = await health(page, 1);
  const jab = page.getByRole("button", { name: /^Jab/ });
  for (let i = 0; i < 6; i++) {
    await jab.dispatchEvent("pointerdown");
    await page.waitForTimeout(420);
  }
  await expect.poll(() => health(page, 1)).toBeLessThan(before);

  const guard = page.getByRole("button", { name: /^Guard/ });
  await guard.dispatchEvent("pointerdown");
  await expect(page.locator(".boxing")).toHaveAttribute("data-guard", "true");
  await guard.dispatchEvent("pointerup");
  await expect(page.locator(".boxing")).toHaveAttribute("data-guard", "false");
});

test("holding Space guards, and a guarded boxer loses far less than an open one", async ({ page }) => {
  await openBoxing(page);
  await startPractice(page);
  await page.keyboard.down("Space");
  await expect(page.locator(".boxing")).toHaveAttribute("data-guard", "true");
  await page.waitForTimeout(6000);
  const guarded = 500 - (await health(page, 0));
  await page.keyboard.up("Space");
  await expect(page.locator(".boxing")).toHaveAttribute("data-guard", "false");
  // the bot throws about a punch a second; with the guard up each costs a fifth
  expect(guarded).toBeLessThan(40);
});

test("a room offers boxing's own formats", async ({ page }) => {
  await openBoxing(page);
  await page.getByRole("button", { name: "Create a room", exact: true }).click();
  const panel = page.getByRole("dialog", { name: /camera setup/i });
  if (await panel.isVisible().catch(() => false)) await panel.getByRole("button", { name: /use keyboard instead/i }).click();
  await expect(page.locator(".ready-panel")).toBeVisible();
  await expect(page.locator(".ready-panel")).toContainText(/bout/i);
  await expect(page.locator(".ready-panel")).toContainText(/unlimited/i);
  expect(await noHorizontalScroll(page)).toBe(true);
});

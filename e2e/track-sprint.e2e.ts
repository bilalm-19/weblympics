import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { useKeyboard } from "./flow.ts";

// Task 26: the track sprint at both viewports. Keys and the two tap buttons
// stand in for running on the spot, as every camera action has one; the
// camera itself runs on Chrome's fake webcam (a test pattern, no person).

type Box = { x: number; y: number; width: number; height: number };
const overlap = (p: Box, q: Box) => p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function insideViewport(page: Page, locator: Locator): Promise<void> {
  const v = page.viewportSize()!;
  const b = (await locator.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(v.width);
  expect(b.y + b.height).toBeLessThanOrEqual(v.height);
}

async function laidOut(page: Page, selectors: string[]): Promise<void> {
  const boxes: Array<[string, Box]> = [];
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (!(await el.isVisible())) continue;
    await insideViewport(page, el);
    const box = await el.boundingBox();
    if (box) boxes.push([sel, box]);
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i][1], boxes[j][1]), `${boxes[i][0]} overlaps ${boxes[j][0]}`).toBe(false);
  expect(await noHorizontalScroll(page)).toBe(true);
}

const canvas = (page: Page) => page.locator(".track canvas");
const distance = async (page: Page, seat: 0 | 1) => Number(await canvas(page).getAttribute(`data-d${seat}`));

async function openTrack(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /Track/ }).click();
  await expect(page.locator("#options-title")).toHaveText("Track");
}

async function waitForGun(page: Page, timeout = 5_000): Promise<void> {
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-frames"))).toBeGreaterThan(5);
  await expect(canvas(page)).toHaveAttribute("data-phase", "running", { timeout });
}

/** Alternating keys for `ms`, about 7 steps a second. */
async function runKeys(page: Page, ms: number): Promise<void> {
  for (let t = 0, i = 0; t < ms; t += 140, i++) {
    await page.keyboard.press(i % 2 ? "KeyD" : "KeyA");
    await page.waitForTimeout(140);
  }
}

test("the track tile is playable and opens its own options", async ({ page }) => {
  await openTrack(page);
  const tile = page.getByRole("button", { name: /Track/ });
  await expect(tile).toHaveAttribute("aria-pressed", "true");
  for (const name of ["Play vs bot", "Practice", "Create a room"]) await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
});

test("practice: alternate A and D to run, in the page, nothing sent to the server", async ({ page }) => {
  const frames: string[] = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => frames.push(String(f.payload))));
  await openTrack(page);
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await useKeyboard(page);
  await expect(page.locator(".tr-board")).toContainText("Practice · Sprint · 100 m");
  await expect(page.locator(".tr-row")).toHaveCount(2);
  const sent = frames.length;
  await waitForGun(page);
  await laidOut(page, [".hud .tr-board", ".hud button:visible", ".controls"]);

  await runKeys(page, 1500);
  await expect.poll(() => distance(page, 0)).toBeGreaterThan(2);

  // the same key over and over doesn't run: coast to a stop first (since
  // FULL_CADENCE 4 these keys reach top speed, so the coast is longer), then mash
  await expect.poll(async () => {
    const d = await distance(page, 0);
    await page.waitForTimeout(300);
    return (await distance(page, 0)) - d;
  }, { timeout: 10_000 }).toBe(0);
  const before = await distance(page, 0);
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("KeyA");
    await page.waitForTimeout(100);
  }
  // one step from a standstill moves the runner a little; the other nine add nothing
  expect((await distance(page, 0)) - before).toBeLessThan(1);
  expect(Number(await canvas(page).getAttribute("data-steps0"))).toBeLessThanOrEqual(13);

  expect(frames.slice(sent).map((f) => JSON.parse(f).t).filter((t) => t !== "pong"), "practice sends nothing").toEqual([]);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator("#options-title")).toHaveText("Track");
});

test("the two tap buttons run too", async ({ page }) => {
  await openTrack(page);
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await useKeyboard(page);
  await waitForGun(page);
  const left = page.getByRole("button", { name: /Left foot/ });
  const right = page.getByRole("button", { name: /Right foot/ });
  for (const b of [left, right]) await insideViewport(page, b);
  for (let i = 0; i < 12; i++) {
    const b = i % 2 ? right : left;
    const box = (await b.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(140);
  }
  await expect.poll(() => distance(page, 0)).toBeGreaterThan(1);
});

test("vs the bot: the server runs both lanes from the steps it is sent", async ({ page }) => {
  test.setTimeout(60_000);
  const sent: string[] = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => sent.push(String(f.payload))));
  await openTrack(page);
  await page.getByRole("button", { name: "Play vs bot" }).click();
  await useKeyboard(page);
  await expect(page.locator(".tr-board")).toContainText("Sprint · 100 m");
  await waitForGun(page);
  await laidOut(page, [".hud .tr-board", ".hud button:visible", ".controls"]);
  await runKeys(page, 2000);
  await expect.poll(() => distance(page, 0)).toBeGreaterThan(2);
  await expect.poll(() => distance(page, 1)).toBeGreaterThan(5);
  // only steps went up: never a distance or a finish
  const steps = sent.map((f) => JSON.parse(f)).filter((m) => m.t === "step");
  expect(steps.length).toBeGreaterThan(5);
  for (const m of steps) expect(Object.keys(m).sort()).toEqual(["at", "side", "t"]);
});

test("a room offers track's own formats", async ({ page }) => {
  await openTrack(page);
  await page.getByRole("button", { name: "Create a room" }).click();
  await useKeyboard(page);
  const panel = page.locator(".ready-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator("[data-format]")).toHaveText(["Race", "Unlimited"]);
  await expect(panel.locator('[data-format="race"]')).toHaveAttribute("aria-checked", "true");
  await insideViewport(page, panel);
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("camera: both run modes can be picked, the fake webcam starts, and keys still run", async ({ page }) => {
  test.setTimeout(120_000);
  await openTrack(page);
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  // the setup opens by itself (task 15)
  const panel = page.getByRole("dialog", { name: /camera setup/i });
  await expect(panel.getByRole("heading", { name: /run with your camera/i })).toBeVisible();
  await insideViewport(page, panel);
  await expect(panel.getByRole("button", { name: /pump your arms/i })).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("button", { name: /lift your knees/i }).click();
  await expect(panel.getByRole("button", { name: /lift your knees/i })).toHaveAttribute("aria-pressed", "true");
  await expect(panel).toContainText(/knees are in view/i);
  await panel.getByRole("button", { name: /pump your arms/i }).click();
  await panel.getByRole("button", { name: /start camera/i }).click();

  const video = page.locator("video.selfview");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 10_000 }).toBeGreaterThan(0);
  // the fake webcam has no person: calibration waits, then can be skipped
  await expect(panel.getByRole("heading", { name: /stand still|couldn't see you/i })).toBeVisible({ timeout: 40_000 });
  await insideViewport(page, panel);
  await panel.getByRole("button", { name: /skip|not now/i }).click();
  await expect(panel).toBeHidden();
  await insideViewport(page, video);
  expect(await noHorizontalScroll(page)).toBe(true);

  // with the camera on but uncalibrated, the keys still run. The pose model on
  // a software-rendered page starves the in-page sim's timer, so allow longer.
  await waitForGun(page, 30_000);
  await runKeys(page, 2000);
  await expect.poll(() => distance(page, 0), { timeout: 20_000 }).toBeGreaterThan(0.5);
});

// Task 15 for track (user, 2026-11-08): a seated player's track game opens the
// camera setup first, as every other game does; practice holds the race (the
// pacer doesn't run off) until the setup is finished or skipped.
test("practice opens the camera setup first, holds the race, and Use keyboard instead gives a playable race", async ({ page }) => {
  await openTrack(page);
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  const panel = page.getByRole("dialog", { name: /camera setup/i });
  await expect(panel.getByRole("heading", { name: /run with your camera/i })).toBeVisible();
  const keyboard = panel.getByRole("button", { name: /use keyboard instead/i });
  await insideViewport(page, panel);
  await insideViewport(page, keyboard);
  expect(await noHorizontalScroll(page)).toBe(true);
  // held at "set": the gun never goes and the pacer stays on the line
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-frames"))).toBeGreaterThan(5);
  await page.waitForTimeout(3000);
  await expect(canvas(page)).toHaveAttribute("data-phase", "set");
  expect(await distance(page, 1)).toBe(0);

  await keyboard.click();
  await expect(panel).toBeHidden();
  await waitForGun(page);
  await runKeys(page, 1500);
  await expect.poll(() => distance(page, 0)).toBeGreaterThan(2);
  // the camera is still one button away; Escape is the keyboard way out too
  await page.getByRole("button", { name: "Camera", exact: true }).click();
  await expect(panel.getByRole("heading", { name: /run with your camera/i })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});

test("a room opens the camera setup first for a player, over the ready panel", async ({ page }) => {
  await openTrack(page);
  await page.getByRole("button", { name: "Create a room" }).click();
  const panel = page.getByRole("dialog", { name: /camera setup/i });
  await expect(panel.getByRole("heading", { name: /run with your camera/i })).toBeVisible();
  await insideViewport(page, panel.getByRole("button", { name: /use keyboard instead/i }));
  await expect(page.getByRole("button", { name: "I'm ready" })).toBeHidden();
  await useKeyboard(page);
  await expect(page.getByRole("button", { name: "I'm ready" })).toBeVisible();
});

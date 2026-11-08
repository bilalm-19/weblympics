import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { useKeyboard } from "./flow.ts";

// Task 27: hurdles, track's second event, at both viewports. Space and the
// Jump button stand in for the camera's jump; the camera setup runs on
// Chrome's fake webcam (a test pattern, no person) and explains the jump.

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
const num = async (page: Page, attr: string) => Number(await canvas(page).getAttribute(`data-${attr}`));

async function openTrack(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /Track/ }).click();
  await expect(page.locator("#options-title")).toHaveText("Track");
}

async function hurdlesPractice(page: Page): Promise<void> {
  await openTrack(page);
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await useKeyboard(page);
  await page.getByRole("radio", { name: "Hurdles" }).click();
  await expect(page.locator(".tr-board")).toContainText("Hurdles");
  await expect(canvas(page)).toHaveAttribute("data-event", "hurdles");
}

async function waitForGun(page: Page, timeout = 5_000): Promise<void> {
  await expect.poll(() => num(page, "frames")).toBeGreaterThan(5);
  await expect(canvas(page)).toHaveAttribute("data-phase", "running", { timeout });
}

/** Alternating keys for `ms`, about 7 steps a second; `jumpEvery` presses Space every that many steps. */
async function runKeys(page: Page, ms: number, jumpEvery = 0): Promise<void> {
  for (let t = 0, i = 0; t < ms; t += 140, i++) {
    await page.keyboard.press(i % 2 ? "KeyD" : "KeyA");
    if (jumpEvery && i % jumpEvery === jumpEvery - 1) await page.keyboard.press("Space");
    await page.waitForTimeout(140);
  }
}

test("practice: pick hurdles, Space jumps, the board counts hurdles, nothing sent to the server", async ({ page }) => {
  test.setTimeout(60_000);
  const frames: string[] = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => frames.push(String(f.payload))));
  await hurdlesPractice(page);
  const sent = frames.length;
  await expect(page.getByRole("button", { name: /^Jump/ })).toBeVisible();
  await expect(page.locator(".tr-hurdles").first()).toHaveText(/0\/10 cleared/);
  await waitForGun(page);
  await laidOut(page, [".hud .tr-board", ".hud button:visible", ".controls"]);
  await runKeys(page, 4000, 5);
  await expect.poll(() => num(page, "jumps0")).toBeGreaterThan(0);
  // past the first hurdle (13 m): it was either cleared or knocked down, and the board says so
  await expect.poll(() => num(page, "d0")).toBeGreaterThan(14);
  expect((await num(page, "cleared0")) + (await num(page, "hit0"))).toBeGreaterThan(0);
  await expect(page.locator(".tr-row[data-seat='0'] .tr-hurdles")).toHaveText(new RegExp(`${await num(page, "cleared0")}/10 cleared`));
  // the pacer jumps its hurdles too
  await expect.poll(() => num(page, "jumps1")).toBeGreaterThan(0);
  expect(frames.slice(sent).map((f) => JSON.parse(f).t).filter((t) => t !== "pong"), "practice sends nothing").toEqual([]);
});

test("the Jump button jumps; the sprint has no Jump button and Space does nothing there", async ({ page }) => {
  await hurdlesPractice(page);
  await waitForGun(page);
  const jumpBtn = page.getByRole("button", { name: /^Jump/ });
  await insideViewport(page, jumpBtn);
  await laidOut(page, [".controls .tr-step[data-side='left']", ".controls .tr-jump", ".controls .tr-step[data-side='right']"]);
  // running first, so the jump has a speed to leave the ground with
  await runKeys(page, 700);
  const box = (await jumpBtn.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(() => num(page, "jumps0")).toBe(1);

  await page.getByRole("radio", { name: "Sprint" }).click();
  await expect(canvas(page)).toHaveAttribute("data-event", "sprint");
  await expect(jumpBtn).toBeHidden();
  await expect(page.locator(".tr-hurdles")).toHaveCount(0);
  await waitForGun(page);
  await page.keyboard.press("Space");
  await page.waitForTimeout(200);
  expect(await num(page, "jumps0")).toBe(0);
});

test("vs the bot: the server runs hurdles from steps and jumps; only { t, at } goes up for a jump", async ({ page }) => {
  test.setTimeout(60_000);
  const sent: string[] = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => sent.push(String(f.payload))));
  await openTrack(page);
  await page.getByRole("button", { name: "Play vs bot" }).click();
  await useKeyboard(page);
  await expect(page.locator(".tr-board")).toContainText("Sprint · 100 m");
  await page.getByRole("radio", { name: "Hurdles" }).click();
  await expect(page.locator(".tr-board")).toContainText("Hurdles · 100 m");
  await waitForGun(page);
  await laidOut(page, [".hud .tr-board", ".hud button:visible", ".controls"]);
  await runKeys(page, 3000, 5);
  await expect.poll(() => num(page, "jumps0")).toBeGreaterThan(0);
  await expect.poll(() => num(page, "jumps1"), { timeout: 15_000 }).toBeGreaterThan(0);
  const jumps = sent.map((f) => JSON.parse(f)).filter((m) => m.t === "jump");
  expect(jumps.length).toBeGreaterThan(0);
  for (const m of jumps) expect(Object.keys(m).sort()).toEqual(["at", "t"]);
});

test("a room: the host picks the event in the ready panel", async ({ page }) => {
  await openTrack(page);
  await page.getByRole("button", { name: "Create a room" }).click();
  await useKeyboard(page);
  const panel = page.locator(".ready-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator("[data-event]")).toHaveText(["Sprint", "Hurdles"]);
  await expect(panel.locator('[data-event="sprint"]')).toHaveAttribute("aria-checked", "true");
  await panel.locator('[data-event="hurdles"]').click();
  await expect(panel.locator('[data-event="hurdles"]')).toHaveAttribute("aria-checked", "true");
  await expect(panel.locator(".rp-event-note")).toContainText(/ten hurdles/);
  await expect(page.locator(".tr-board")).toContainText("Hurdles");
  await insideViewport(page, panel);
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("camera: the setup explains the jump for each mode, the fake webcam starts, and Space still jumps", async ({ page }) => {
  test.setTimeout(120_000);
  await hurdlesPractice(page);
  await page.getByRole("button", { name: "Camera", exact: true }).click();
  const panel = page.getByRole("dialog", { name: /camera setup/i });
  await expect(panel.getByRole("heading", { name: /run with your camera/i })).toBeVisible();
  await insideViewport(page, panel);
  await expect(panel.locator(".tr-jump-how")).toHaveText(/both hands together/i);
  await panel.getByRole("button", { name: /lift your knees/i }).click();
  await expect(panel.locator(".tr-jump-how")).toHaveText(/jump on the spot/i);
  await panel.getByRole("button", { name: /pump your arms/i }).click();
  await panel.getByRole("button", { name: /start camera/i }).click();

  const video = page.locator("video.selfview");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(panel.getByRole("heading", { name: /stand still|couldn't see you/i })).toBeVisible({ timeout: 40_000 });
  await panel.getByRole("button", { name: /skip|not now/i }).click();
  await expect(panel).toBeHidden();
  expect(await noHorizontalScroll(page)).toBe(true);

  // the fake webcam has no person, so no jump is read from it; Space still jumps
  await waitForGun(page, 30_000);
  await runKeys(page, 1500);
  await page.keyboard.press("Space");
  await expect.poll(() => num(page, "jumps0"), { timeout: 20_000 }).toBeGreaterThan(0);
});

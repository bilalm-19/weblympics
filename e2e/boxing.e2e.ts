import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// Task 30 (ADR 002): boxing at both viewports. J and K jab to the head and
// body, Space and L hold the high and low guard, A and D held lean (slip); six buttons do
// the same on a phone. Practice runs in the page and sends nothing.

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
  // A and D lean while held (playtest 4: the slip stays while you lean), and let go comes back
  await page.keyboard.down("KeyA");
  await expect(canvas(page)).toHaveAttribute("data-slip0", "left");
  await page.waitForTimeout(1500);
  await expect(canvas(page)).toHaveAttribute("data-slip0", "left");
  await page.keyboard.up("KeyA");
  await expect(canvas(page)).toHaveAttribute("data-slip0", "none");
  await page.keyboard.down("KeyD");
  await expect(canvas(page)).toHaveAttribute("data-slip0", "right");
  await page.keyboard.up("KeyD");
  await expect(canvas(page)).toHaveAttribute("data-slip0", "none");
  // hold L for the low guard; the server's snapshot carries it
  await page.keyboard.down("KeyL");
  await expect(page.locator(".boxing")).toHaveAttribute("data-guard", "low");
  await expect(canvas(page)).toHaveAttribute("data-g0", "low");
  await page.keyboard.up("KeyL");
  await expect(canvas(page)).toHaveAttribute("data-g0", "none");

  expect(frames.slice(sent).map((f) => JSON.parse(f).t).filter((t) => t !== "pong"), "practice sends nothing").toEqual([]);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator("#options-title")).toHaveText("Boxing");
});

test("the six buttons: Head and Body jab, the guards go up while held, the slips lean", async ({ page }) => {
  await openBoxing(page);
  await startPractice(page);
  const names = ["Head", "Body", "High guard", "Low guard", "Slip ◀", "Slip ▶"];
  const v = page.viewportSize()!;
  for (const name of names) {
    const b = page.locator(".bx-controls button", { hasText: name });
    await expect(b).toBeVisible();
    const box = (await b.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(v.width);
    expect(box.y + box.height).toBeLessThanOrEqual(v.height);
  }
  expect(await noHorizontalScroll(page)).toBe(true);

  const before = await health(page, 1);
  const head = page.getByRole("button", { name: /^Head jab/ });
  const body = page.getByRole("button", { name: /^Body jab/ });
  for (let i = 0; i < 6; i++) {
    await (i % 2 ? body : head).dispatchEvent("pointerdown");
    await page.waitForTimeout(420);
  }
  await expect.poll(() => health(page, 1)).toBeLessThan(before);

  for (const [name, g] of [[/^High guard/, "high"], [/^Low guard/, "low"]] as const) {
    const b = page.getByRole("button", { name });
    await b.dispatchEvent("pointerdown");
    await expect(page.locator(".boxing")).toHaveAttribute("data-guard", g);
    await expect(canvas(page)).toHaveAttribute("data-g0", g);
    await b.dispatchEvent("pointerup");
    await expect(page.locator(".boxing")).toHaveAttribute("data-guard", "none");
  }
  const slipRight = page.getByRole("button", { name: /^Slip right/ });
  await slipRight.dispatchEvent("pointerdown");
  await expect(canvas(page)).toHaveAttribute("data-slip0", "right");
  await page.waitForTimeout(1000);
  await expect(canvas(page)).toHaveAttribute("data-slip0", "right");
  await slipRight.dispatchEvent("pointerup");
  await expect(canvas(page)).toHaveAttribute("data-slip0", "none");
});

test("holding Space raises the high guard; the bot goes to the body, and the low guard is still yours to find", async ({ page }) => {
  await openBoxing(page);
  await startPractice(page);
  await page.keyboard.down("Space");
  await expect(page.locator(".boxing")).toHaveAttribute("data-guard", "high");
  await expect(canvas(page)).toHaveAttribute("data-g0", "high");
  // a guarded or clean hit is drawn and named on the canvas
  await expect.poll(() => canvas(page).getAttribute("data-outcome"), { timeout: 15_000 }).toMatch(/^(clean|blocked)$/);
  await page.keyboard.up("Space");
  await expect(page.locator(".boxing")).toHaveAttribute("data-guard", "none");
  await expect(canvas(page)).toHaveAttribute("data-g0", "none");
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

test("camera: the panel offers a keyboard way out, the fake webcam starts, and keys still box", async ({ page }) => {
  test.setTimeout(120_000);
  await openBoxing(page);
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  // practice holds the bout while the setup is open
  await page.getByRole("button", { name: "Camera", exact: true }).click();
  const panel = page.getByRole("dialog", { name: /camera setup/i });
  await expect(panel.getByRole("heading", { name: /box with your camera/i })).toBeVisible();
  await expect(panel.getByRole("button", { name: /use keyboard instead/i })).toBeVisible();
  const b = (await panel.boundingBox())!;
  const v = page.viewportSize()!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(v.width);
  expect(b.y + b.height).toBeLessThanOrEqual(v.height);
  await panel.getByRole("button", { name: /start camera/i }).click();

  const video = page.locator("video.selfview");
  await expect.poll(() => video.evaluate((x: HTMLVideoElement) => x.videoWidth), { timeout: 10_000 }).toBeGreaterThan(0);
  // the fake webcam has no person: the pose model loads, then the panel says it is ready
  await expect(panel.getByRole("heading", { name: /ready to box/i })).toBeVisible({ timeout: 40_000 });
  await panel.getByRole("button", { name: /start boxing/i }).click();
  await expect(panel).toBeHidden();
  await expect(page.locator(".tracking")).toBeVisible();
  await expect(page.locator(".bx-read")).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);

  // with the camera on, J and K still work. The pose model on a
  // software-rendered page starves the in-page sim's timer, so allow longer.
  await expect(canvas(page)).toHaveAttribute("data-phase", "round", { timeout: 30_000 });
  const before = Number(await canvas(page).getAttribute("data-sent") ?? 0);
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press(i % 2 ? "KeyK" : "KeyJ");
    await page.waitForTimeout(500);
  }
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-sent") ?? 0), { timeout: 20_000 }).toBeGreaterThan(before);
  // turning the camera off puts the button back
  await page.getByRole("button", { name: "Stop camera" }).click();
  await expect(page.getByRole("button", { name: "Camera", exact: true })).toBeVisible();
});

test("camera: 'Use keyboard instead' closes the panel and the bout carries on", async ({ page }) => {
  await openBoxing(page);
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await page.getByRole("button", { name: "Camera", exact: true }).click();
  const panel = page.getByRole("dialog", { name: /camera setup/i });
  await panel.getByRole("button", { name: /use keyboard instead/i }).click();
  await expect(panel).toBeHidden();
  await expect(canvas(page)).toHaveAttribute("data-phase", "round");
  await page.keyboard.press("KeyJ");
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-sent") ?? 0)).toBeGreaterThanOrEqual(1);
});

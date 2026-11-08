import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

// Task 15: the webcam is the default. Starting a game opens the camera setup
// first (safety notice, then start camera), with "Use keyboard instead" on
// every step; a refused permission also ends in a playable game. Runs at both
// viewports with Chrome's fake webcam (nobody in it).

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function insideViewport(page: Page, locator: Locator): Promise<void> {
  const v = page.viewportSize()!;
  const b = (await locator.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(v.width);
  expect(b.y + b.height).toBeLessThanOrEqual(v.height);
}

function sentMessages(page: Page): Record<string, unknown>[] {
  const sent: Record<string, unknown>[] = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => sent.push(JSON.parse(String(f.payload)))));
  return sent;
}

const panelOf = (page: Page) => page.getByRole("dialog", { name: /camera setup/i });

test("practice opens the camera setup first; Use keyboard instead reaches a game played on keys", async ({ page }) => {
  const sent = sentMessages(page);
  await page.goto("/");
  await page.getByRole("button", { name: /practice vs bot/i }).click();
  const panel = panelOf(page);
  await expect(panel.getByRole("heading", { name: /before you start/i })).toBeVisible();
  const keyboard = panel.getByRole("button", { name: /use keyboard instead/i });
  await insideViewport(page, panel);
  await insideViewport(page, keyboard);
  expect(await noHorizontalScroll(page)).toBe(true);
  // the bot waits while the setup is open
  await expect(page.locator(".hud .status")).toHaveText(/paused/i);

  await keyboard.click();
  await expect(panel).toBeHidden();
  await expect(page.locator(".hud .status")).not.toHaveText(/paused/i);
  // Space swings: the Camera button isn't focused, so it doesn't reopen the setup
  await page.keyboard.press("Space");
  await expect.poll(() => sent.filter((m) => m.t === "swing").length).toBe(1);
  await expect(panel).toBeHidden();
  await page.getByRole("button", { name: /hard swing/i }).click();
  await expect.poll(() => sent.filter((m) => m.t === "swing").length).toBe(2);
  // and the camera is still one button away
  await page.getByRole("button", { name: "Camera", exact: true }).click();
  await expect(panel.getByRole("heading", { name: /before you start/i })).toBeVisible();
  // Escape is the keyboard way out, too
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});

test("the second step offers the keyboard too", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /practice vs bot/i }).click();
  const panel = panelOf(page);
  await panel.getByRole("button", { name: "Got it" }).click();
  await expect(panel.getByRole("heading", { name: /play with your camera/i })).toBeVisible();
  await insideViewport(page, panel.getByRole("button", { name: /use keyboard instead/i }));
  await panel.getByRole("button", { name: /use keyboard instead/i }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole("button", { name: /medium swing/i })).toBeVisible();
});

test("a refused camera permission falls back to a playable game", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
  });
  const sent = sentMessages(page);
  await page.goto("/");
  await page.getByRole("button", { name: /practice vs bot/i }).click();
  const panel = panelOf(page);
  await panel.getByRole("button", { name: "Got it" }).click();
  await panel.getByRole("button", { name: /start camera/i }).click();
  await expect(panel.getByRole("alert")).toHaveText(/camera blocked/i);
  await insideViewport(page, panel);
  await panel.getByRole("button", { name: /keep playing/i }).click();
  await expect(panel).toBeHidden();
  await page.keyboard.press("Space");
  await expect.poll(() => sent.filter((m) => m.t === "swing").length).toBe(1);
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("creating a room opens the camera setup first; the ready panel follows and works without a camera", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /create a room/i }).click();
  await expect(page).toHaveURL(/#\/room\/[A-Z]{4}$/);
  const panel = panelOf(page);
  await expect(panel.getByRole("heading", { name: /before you start/i })).toBeVisible();
  const ready = page.getByRole("region", { name: /match setup/i });
  // the setup takes the stage; the ready panel is back once it closes
  await expect(ready).toBeHidden();
  await panel.getByRole("button", { name: /use keyboard instead/i }).click();
  await expect(ready).toBeVisible();
  await expect(ready.getByText(/camera off \(optional\)/i)).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("training follows the camera setup: Train first goes to training with the camera on; Skip training is remembered", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByRole("button", { name: /practice vs bot/i }).click();
  const panel = panelOf(page);
  await panel.getByRole("button", { name: "Got it" }).click();
  await panel.getByRole("button", { name: /start camera/i }).click();
  await expect(panel.getByRole("heading", { name: /can we see you/i })).toBeVisible({ timeout: 40_000 });
  await panel.getByRole("button", { name: "Skip check" }).click();

  // the step after the camera setup: training, offered (Train also stays on the home screen)
  await expect(panel.getByRole("heading", { name: /camera ready/i })).toBeVisible();
  await insideViewport(page, panel);
  await panel.getByRole("button", { name: "Train first" }).click();
  await expect(page).toHaveURL(/#\/train$/);
  const coach = page.locator(".coach");
  // the camera comes straight back on (no second safety notice or choices)
  await expect(page.locator("video.selfview")).toBeVisible({ timeout: 40_000 });
  await expect(panelOf(page).getByRole("heading", { name: /can we see you/i })).toBeVisible({ timeout: 40_000 });
  await panelOf(page).getByRole("button", { name: "Skip check" }).click();
  await expect(panelOf(page)).toBeHidden();
  await expect(coach).toHaveAttribute("data-lesson", "start");
  await expect(coach.getByRole("button", { name: "Start" })).toBeEnabled();
  await coach.getByRole("button", { name: "Start" }).click();
  await expect(coach).toHaveAttribute("data-lesson", "swing");
  expect(await noHorizontalScroll(page)).toBe(true);

  // out of training, and into practice again: the setup opens, but training isn't offered twice
  await coach.getByRole("button", { name: "Skip training" }).click();
  await page.getByRole("button", { name: /practice vs bot/i }).click();
  await panelOf(page).getByRole("button", { name: "Got it" }).click();
  await panelOf(page).getByRole("button", { name: /start camera/i }).click();
  await expect(panelOf(page).getByRole("heading", { name: /can we see you/i })).toBeVisible({ timeout: 40_000 });
  await panelOf(page).getByRole("button", { name: "Skip check" }).click();
  await expect(panelOf(page)).toBeHidden();
});

test("Skip training on the offer goes straight to the practice game", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.getByRole("button", { name: /practice vs bot/i }).click();
  const panel = panelOf(page);
  await panel.getByRole("button", { name: "Got it" }).click();
  await panel.getByRole("button", { name: /start camera/i }).click();
  await expect(panel.getByRole("heading", { name: /can we see you/i })).toBeVisible({ timeout: 40_000 });
  await panel.getByRole("button", { name: "Skip check" }).click();
  await panel.getByRole("button", { name: "Skip training" }).click();
  await expect(panel).toBeHidden();
  await expect(page).not.toHaveURL(/#\/train$/);
  await expect(page.locator(".hud .score")).toBeVisible();
  await expect(page.locator("video.selfview")).toBeVisible();
  await expect(page.locator(".hud .status")).not.toHaveText(/paused/i);
});

// Archery started without asking for the camera (user, 2026-11-08). Its
// practice and room now open the bow camera setup first, like every game.
test("archery practice opens the camera setup first; nothing advances until Use keyboard instead, then it plays on keys", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Archery/ }).click();
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  const panel = panelOf(page);
  await expect(panel.getByRole("heading", { name: /shoot with your camera/i })).toBeVisible();
  const keyboard = panel.getByRole("button", { name: /use keyboard instead/i });
  await insideViewport(page, panel);
  await insideViewport(page, keyboard);
  expect(await noHorizontalScroll(page)).toBe(true);

  // practice waits: the sim's clock doesn't move while the setup is open
  const canvas = page.locator(".archery canvas");
  await expect.poll(async () => Number(await canvas.getAttribute("data-frames"))).toBeGreaterThan(5);
  const tick = Number(await canvas.getAttribute("data-tick"));
  await page.waitForTimeout(1000);
  expect(Number(await canvas.getAttribute("data-tick"))).toBe(tick);
  // and keys don't shoot behind it
  await page.keyboard.down("Space");
  await page.waitForTimeout(600);
  await page.keyboard.up("Space");
  await expect(canvas).toHaveAttribute("data-phase", "aim");

  await keyboard.click();
  await expect(panel).toBeHidden();
  await expect.poll(async () => Number(await canvas.getAttribute("data-tick"))).toBeGreaterThan(tick);
  // Space draws and shoots; the hold button is there too
  await page.keyboard.down("Space");
  await page.waitForTimeout(900);
  await page.keyboard.up("Space");
  await expect(canvas).toHaveAttribute("data-shots", "1", { timeout: 5_000 });
  await insideViewport(page, page.locator(".ar-shoot"));

  // the camera is still one button away, and Escape is the keyboard way out
  await page.getByRole("button", { name: "Camera", exact: true }).click();
  await expect(panel.getByRole("heading", { name: /shoot with your camera/i })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});

test("archery: a refused camera permission falls back to a playable practice", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Archery/ }).click();
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  const panel = panelOf(page);
  await panel.getByRole("button", { name: /start camera/i }).click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await insideViewport(page, panel);
  await panel.getByRole("button", { name: "OK" }).click();
  await expect(panel).toBeHidden();
  await page.keyboard.down("Space");
  await page.waitForTimeout(900);
  await page.keyboard.up("Space");
  await expect(page.locator(".archery canvas")).toHaveAttribute("data-shots", "1", { timeout: 5_000 });
});

test("an archery room opens the camera setup on top: nothing covers Use keyboard instead; a watcher gets none", async ({ page, browser }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Archery/ }).click();
  await page.getByRole("button", { name: /create a room/i }).click();
  await expect(page).toHaveURL(/#\/room\/[A-Z]{4}$/);
  const panel = panelOf(page);
  await expect(panel.getByRole("heading", { name: /shoot with your camera/i })).toBeVisible();
  const keys = panel.getByRole("button", { name: /use keyboard instead/i });
  await insideViewport(page, keys);
  const b = (await keys.boundingBox())!;
  // the element under the button's middle must be the button itself
  const onTop = await page.evaluate(
    ([x, y]) => /use keyboard instead/i.test(document.elementFromPoint(x, y)?.closest("button")?.textContent ?? ""),
    [b.x + b.width / 2, b.y + b.height / 2],
  );
  expect(onTop, "Use keyboard instead is covered").toBe(true);
  const ready = page.getByRole("region", { name: /match setup/i });
  await expect(ready).toBeHidden();
  await keys.click();
  await expect(panel).toBeHidden();
  await expect(ready).toBeVisible();
  await expect(ready.getByText(/camera off \(optional\)/i)).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);

  // a spectator (watch link) gets no setup
  const mobile = testInfo.project.name === "mobile";
  const ctx = await browser.newContext({ viewport: page.viewportSize()!, isMobile: mobile, hasTouch: mobile });
  const watcher = await ctx.newPage();
  await watcher.goto(`/#/watch/${page.url().slice(-4)}`);
  await expect(watcher.locator(".watch-badge")).toBeVisible({ timeout: 15_000 });
  await expect(watcher.getByRole("dialog", { name: /camera setup/i })).toBeHidden();
  await expect(watcher.getByRole("button", { name: /^camera$/i })).toBeHidden();
  await ctx.close();
});

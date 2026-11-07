import { expect, test } from "@playwright/test";
import type { Browser, Locator, Page, TestInfo } from "@playwright/test";

// Task 29: bowling at both viewports, on keys and the buttons (every camera
// action has one). Practice runs in the page and sends nothing; vs the bot
// the server rolls every ball; a room offers bowling's own formats; a
// spectator sees the game and gets no controls.

type Box = { x: number; y: number; width: number; height: number };
const overlap = (p: Box, q: Box) => p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function insideViewport(page: Page, locator: Locator): Promise<void> {
  const v = page.viewportSize()!;
  const b = (await locator.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(v.width + 0.5);
  expect(b.y + b.height).toBeLessThanOrEqual(v.height + 0.5);
}

/** The box of an element's text (a full-width status row is mostly empty). */
const textBox = (el: Locator) =>
  el.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    return r.width > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  });

/** None of these overlap each other, each is on screen, and the page doesn't scroll sideways. */
async function laidOut(page: Page, selectors: string[]): Promise<void> {
  const boxes: Array<[string, Box]> = [];
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (!(await el.isVisible())) continue;
    await insideViewport(page, el);
    const box = sel.endsWith(".status") ? await textBox(el) : await el.boundingBox();
    if (box) boxes.push([sel, box]);
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i][1], boxes[j][1]), `${boxes[i][0]} overlaps ${boxes[j][0]}`).toBe(false);
  expect(await noHorizontalScroll(page)).toBe(true);
}

const canvas = (page: Page) => page.locator(".bowling canvas");

/** The camera setup opens first (task 15); this plays on keys, as a player without a camera would. */
async function keyboardIfAsked(page: Page): Promise<void> {
  const panel = page.getByRole("dialog", { name: /camera setup/i });
  if (await panel.isVisible().catch(() => false)) {
    await panel.getByRole("button", { name: /use keyboard instead/i }).click();
    await expect(panel).toBeHidden();
  }
}

async function openBowling(page: Page): Promise<void> {
  await page.goto("/");
  // the menu is drawn again when the server's welcome arrives: wait for it (the profile button's name)
  await expect(page.locator(".pm-button .pm-name")).not.toBeEmpty();
  await page.getByRole("button", { name: /Bowling/ }).click();
  await expect(page.locator("#options-title")).toHaveText("Bowling");
}

/** Holds Space for `ms` (the meter fills and falls), then lets go: a throw. */
async function bowl(page: Page, ms = 1000): Promise<void> {
  await expect(page.locator(".bowling")).toHaveAttribute("data-turn", "mine", { timeout: 30_000 });
  await page.keyboard.down("Space");
  await page.waitForTimeout(ms);
  await page.keyboard.up("Space");
}

test("the bowling tile is playable and opens its own options", async ({ page }) => {
  await openBowling(page);
  const tile = page.getByRole("button", { name: /Bowling/ });
  await expect(tile).toHaveAttribute("aria-pressed", "true");
  await expect(tile.locator(".sport-soon")).toHaveCount(0);
  await expect(page.locator(".preview-blurb, .options").first()).toBeVisible();
  for (const name of ["Play vs bot", "Practice", "Create a room"]) await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
});

test("practice: aim, curve and bowl on keys in the page; the call and the speed read follow; nothing sent", async ({ page }) => {
  test.setTimeout(60_000);
  const frames: string[] = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => frames.push(String(f.payload))));
  await openBowling(page);
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await keyboardIfAsked(page);
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-frames"))).toBeGreaterThan(5);
  const sent = frames.length;

  await expect(page.locator(".status")).toHaveText("Your turn");
  await expect(page.locator(".bw-card tr")).toHaveCount(2);
  await laidOut(page, [".hud .bw-board", ".hud button:visible", ".hud .status", ".bw-aim", ".bw-meter", ".controls"]);
  // the guide arrow covers the first third of the lane only
  await expect(canvas(page)).toHaveAttribute("data-arrow", /,6\.10$/);

  // Right moves the start spot, Up curves it right
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(300);
  await page.keyboard.up("ArrowRight");
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-aim"))).toBeGreaterThan(0.1);
  await page.keyboard.press("ArrowUp");
  await expect(canvas(page)).toHaveAttribute("data-spin", "0.2");
  await expect(page.locator(".bw-aim-curve")).toHaveText("Curve: a little right");

  // the meter fills while Space is held; letting go throws
  await page.keyboard.down("Space");
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-meter"))).toBeGreaterThan(0.3);
  await page.keyboard.up("Space");
  await expect(canvas(page)).toHaveAttribute("data-thrown", "1");
  await expect(canvas(page)).toHaveAttribute("data-phase", "roll");
  // the call and the after-ball read
  await expect(page.locator(".bw-call")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".bw-call")).toHaveText(/STRIKE!|Spare!|Split!|Gutter|\d+ pins?|No pins/);
  await expect(page.locator(".bw-read")).toBeVisible();
  await expect(page.locator(".bw-read-label")).toHaveText(/^Speed \d+\.\d m\/s/);
  await expect(page.locator(".bw-read-curve")).toHaveText("Curve: a little right");
  await expect(page.locator(".bw-frame").first().locator("i").first()).not.toHaveText("");
  await laidOut(page, [".hud .bw-board", ".hud button:visible", ".bw-read", ".controls"]);

  // only the page's own keep-alive replies (pong) may go over the socket it opened on load
  expect(frames.slice(sent).map((f) => JSON.parse(f).t).filter((t) => t !== "pong"), "practice sends nothing").toEqual([]);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator("#options-title")).toHaveText("Bowling");
});

test("the Bowl button and the aim buttons play on a touch screen too", async ({ page }) => {
  await openBowling(page);
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await keyboardIfAsked(page);
  for (const b of await page.locator(".bw-controls button").all()) await insideViewport(page, b);
  await page.getByRole("button", { name: /start spot left/i }).click();
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-aim"))).toBeLessThan(0);
  await page.getByRole("button", { name: /curve left/i }).click();
  await expect(canvas(page)).toHaveAttribute("data-spin", "-0.2");
  const b = (await page.locator(".bw-bowl").boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(canvas(page)).toHaveAttribute("data-thrown", "1");
  await expect(page.locator(".bw-call")).toBeVisible({ timeout: 10_000 });
});

test("vs the bot: the server rolls both players' balls and the game plays to the end", async ({ page }) => {
  test.setTimeout(240_000);
  const sent: Array<Record<string, unknown>> = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => sent.push(JSON.parse(String(f.payload)))));
  await openBowling(page);
  await page.getByRole("button", { name: "Play vs bot" }).click();
  await keyboardIfAsked(page);
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-frames"))).toBeGreaterThan(5);
  await expect(page.locator(".bw-head")).toContainText("Five frames · frame 1 of 5");
  await laidOut(page, [".hud .bw-board", ".hud button:visible", ".hud .status", ".bw-aim", ".bw-meter", ".controls"]);
  await expect(page.locator(".bw-clock")).toHaveText(/^0:(1\d|20)$/);

  await bowl(page);
  // only what the player did goes up: a throw with speed, aim, spin and their clock
  await expect.poll(() => sent.filter((m) => m.t === "throw").length).toBe(1);
  expect(Object.keys(sent.find((m) => m.t === "throw")!).sort()).toEqual(["aim", "at", "speed", "spin", "t"]);
  // keep bowling whenever it's my turn until the first game ends
  while ((await canvas(page).getAttribute("data-matches")) === "0") {
    const mine = await page.locator(".bowling").getAttribute("data-turn");
    if (mine === "mine" && (await canvas(page).getAttribute("data-phase")) === "aim") await bowl(page, 1000);
    else await page.waitForTimeout(250);
  }
  await expect(page.locator(".bw-end")).toBeVisible();
  await expect(page.locator(".bw-end-title")).toHaveText(/You win!|Bot wins|Draw/);
  await expect(page.locator(".bw-end-score")).toHaveText(/You \d+ · Bot \d+/);
  const totals = (await canvas(page).getAttribute("data-totals"))!.split(",").map(Number);
  await expect(page.locator('.bw-card tr[data-seat="0"] .bw-total')).toHaveText(String(totals[0]));
  await laidOut(page, [".hud .bw-board", ".hud button:visible", ".bw-end", ".controls"]);
});

test("a room offers bowling's own formats", async ({ page }) => {
  await openBowling(page);
  await page.getByRole("button", { name: "Create a room" }).click();
  await keyboardIfAsked(page);
  const panel = page.locator(".ready-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator("[data-format]")).toHaveText(["Five frames", "Unlimited"]);
  await expect(panel.locator('[data-format="game"]')).toHaveAttribute("aria-checked", "true");
  await insideViewport(page, panel);
  expect(await noHorizontalScroll(page)).toBe(true);
});

async function newPage(browser: Browser, page: Page, testInfo: TestInfo): Promise<Page> {
  const mobile = testInfo.project.name === "mobile";
  const ctx = await browser.newContext({ viewport: page.viewportSize()!, isMobile: mobile, hasTouch: mobile });
  return ctx.newPage();
}

test("a spectator sees the game, the scoreboard and whose turn it is, and gets no controls", async ({ page, browser }, testInfo) => {
  test.setTimeout(90_000);
  await openBowling(page);
  await page.getByRole("button", { name: "Create a room" }).click();
  await expect(page).toHaveURL(/#\/room\/[A-Z]{4}$/);
  await keyboardIfAsked(page);
  const code = page.url().slice(-4);
  await expect(page.getByRole("button", { name: /copy watch link/i })).toBeVisible();
  const guest = await newPage(browser, page, testInfo);
  await guest.goto(`/#/room/${code}`);
  await keyboardIfAsked(guest);
  for (const p of [page, guest]) await p.getByRole("button", { name: "I'm ready" }).click();
  await expect(page.locator(".ready-panel")).toBeHidden({ timeout: 15_000 });
  await expect(page.locator(".status")).toHaveText("Your turn");
  await expect(guest.locator(".status")).toHaveText("Their turn, watch");

  const watcher = await newPage(browser, page, testInfo);
  await watcher.goto(`/#/watch/${code}`);
  await expect(watcher.locator(".watch-badge")).toBeVisible();
  await expect(watcher.locator(".bw-board")).toBeVisible();
  await expect(watcher.locator(".status")).toHaveText(/to bowl$/);
  await expect.poll(async () => Number(await watcher.locator("canvas").getAttribute("data-frames"))).toBeGreaterThan(10);
  await expect(watcher.getByRole("dialog", { name: /camera setup/i })).toBeHidden();
  await expect(watcher.locator(".controls")).toBeHidden();
  await expect(watcher.getByRole("button", { name: /^camera$/i })).toBeHidden();
  await expect(watcher.locator(".bw-aim")).toBeHidden();
  await expect(watcher.locator(".bw-meter")).toBeHidden();
  // the player's ball reaches the watcher's screen too
  await bowl(page, 900);
  await expect(watcher.locator("canvas")).toHaveAttribute("data-phase", /roll|result/, { timeout: 10_000 });
  await expect(watcher.locator(".bw-call")).toBeVisible({ timeout: 10_000 });
  await insideViewport(watcher, watcher.locator(".watch-badge"));
  await insideViewport(watcher, watcher.locator("canvas"));
  expect(await noHorizontalScroll(watcher)).toBe(true);
  await guest.context().close();
  await watcher.context().close();
});

test("at 390x844 nothing scrolls sideways and the canvas fills the screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBowling(page);
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await keyboardIfAsked(page);
  const c = (await canvas(page).boundingBox())!;
  expect(c.x).toBe(0);
  expect(c.y).toBe(0);
  expect(c.width).toBe(390);
  expect(c.height).toBe(844);
  await laidOut(page, [".hud .bw-board", ".hud button:visible", ".hud .status", ".bw-aim", ".bw-meter", ".controls"]);
  for (const b of await page.locator(".bw-controls button").all()) await insideViewport(page, b);
});

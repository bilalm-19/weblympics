import { expect, test } from "@playwright/test";
import type { Browser, Locator, Page, TestInfo } from "@playwright/test";

// Task 32: basketball at both viewports. Keys, the mouse and the Shoot button
// stand in for the camera's push, as every camera action has one. Practice
// runs in the page and sends nothing; vs the bot the server flies every ball.

type Box = { x: number; y: number; width: number; height: number };
const overlap = (p: Box, q: Box) => p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const canvas = (page: Page) => page.locator(".basketball canvas");

async function insideViewport(page: Page, locator: Locator): Promise<void> {
  const v = page.viewportSize()!;
  const b = (await locator.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(v.width);
  expect(b.y + b.height).toBeLessThanOrEqual(v.height);
}

/** None of these overlap each other, each is on screen, and nothing scrolls sideways. */
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

async function openBasketball(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /Basketball/ }).click();
  await expect(page.locator("#options-title")).toHaveText("Basketball");
}

/** The camera setup opens first for a seated player (task 15); take the keyboard way. */
async function useKeyboard(page: Page): Promise<void> {
  const panel = page.getByRole("dialog", { name: /camera setup/i });
  if (await panel.isVisible().catch(() => false)) {
    await panel.getByRole("button", { name: /use keyboard instead/i }).click();
    await expect(panel).toBeHidden();
  }
}

async function startPractice(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await useKeyboard(page);
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-frames"))).toBeGreaterThan(5);
}

/** Hold the Shoot button about `ms`, then let go. */
async function holdShoot(page: Page, ms: number): Promise<void> {
  const b = page.locator(".bb-shoot");
  await expect(b).toBeEnabled({ timeout: 15_000 });
  const box = (await b.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

test("the basketball tile is playable, has its own looping preview and opens its options", async ({ page }) => {
  await openBasketball(page);
  const tile = page.getByRole("button", { name: /Basketball/ });
  await expect(tile).toHaveAttribute("aria-pressed", "true");
  await expect(tile.locator(".sport-soon")).toHaveCount(0);
  await expect(page.locator(".thumb-frame .loop-hoop-ball")).toHaveCount(1);
  for (const name of ["Play vs bot", "Practice", "Create a room"]) await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  // Bowling's placeholder stays
  await expect(page.locator('.sport[data-sport="bowling"]')).toHaveAttribute("aria-disabled", "true");
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("practice opens the camera setup first, then plays shots on keys in the page, sending nothing", async ({ page }) => {
  test.setTimeout(60_000);
  const frames: string[] = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => frames.push(String(f.payload))));
  await openBasketball(page);
  const sent = frames.length;
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  // the webcam is the default (task 15): the setup opens first, with a keyboard way out
  const panel = page.getByRole("dialog", { name: /camera setup/i });
  if ((await panel.count()) > 0) await useKeyboard(page);
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-frames"))).toBeGreaterThan(5);
  await expect(page.locator(".bb-spot")).toHaveText("Practice · Spot 1 of 5 · Free throw · 2 pts");
  await expect(page.locator(".bb-bonus")).toHaveText("A swish adds 1: 3 pts");
  await expect(page.locator(".hud .status")).toHaveText(/Your shot/);
  await expect(page.locator(".bb-hint")).toContainText("Push up and towards the hoop, like a real shot. No need to jump.");
  await laidOut(page, [".bb-board", ".bb-lower", ".bb-controls"]);

  // the right arrow swings the floor arrow
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(400);
  await page.keyboard.up("ArrowRight");
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-aim"))).toBeGreaterThan(0.1);
  await expect(canvas(page)).toHaveAttribute("data-set", "true");
  // the shot clock runs once set
  await expect(page.locator(".bb-clock")).toBeVisible();

  // hold Space: the bar fills; let go: the ball flies, the call and the power bar follow
  await page.keyboard.down("Space");
  await expect(page.locator(".bb-power")).toBeVisible();
  await expect(page.locator(".bb-power")).toHaveAttribute("data-mode", "live");
  await page.waitForTimeout(300);
  await page.keyboard.up("Space");
  await expect(canvas(page)).toHaveAttribute("data-shots", "1", { timeout: 10_000 });
  await expect(page.locator(".bb-call strong")).toHaveText(/SWISH|Off the|Air ball|Bank|Rattled|In!/);
  await expect(page.locator(".bb-power")).toHaveAttribute("data-mode", "result");
  await expect(page.locator(".bb-verdict")).toHaveText(/Too soft|Just right|Too hard/);
  await laidOut(page, [".bb-board", ".bb-call", ".bb-lower", ".bb-controls"]);
  // the bot shoots on its own turn: "Their shot, watch"
  await expect(page.locator(".hud .status")).toHaveText("Their shot, watch", { timeout: 10_000 });
  await expect(canvas(page)).toHaveAttribute("data-shots", "2", { timeout: 15_000 });

  expect(frames.slice(sent).map((f) => JSON.parse(f).t).filter((t) => t !== "pong" && t !== "hello"), "practice sends nothing").toEqual([]);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator("#options-title")).toHaveText("Basketball");
});

test("vs the bot: the server takes the turns, flies every ball and plays to the end card", async ({ page }) => {
  test.setTimeout(150_000);
  const sent: Record<string, unknown>[] = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => sent.push(JSON.parse(String(f.payload)))));
  await openBasketball(page);
  await page.getByRole("button", { name: "Play vs bot" }).click();
  await useKeyboard(page);
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-frames"))).toBeGreaterThan(5);
  await expect(page.locator(".bb-row")).toHaveCount(2);
  await expect(page.locator(".bb-spot")).toHaveText("Spot 1 of 5 · Free throw · 2 pts");
  await laidOut(page, [".bb-board", ".hud [data-action=leave]", ".bb-lower", ".bb-controls"]);

  // five spots, one shot each: hold the button for ~0.25 s every turn of mine
  for (let spot = 0; spot < 5; spot++) {
    await expect(page.locator(".bb-shoot")).toBeEnabled({ timeout: 20_000 });
    await holdShoot(page, 250);
    await expect.poll(async () => Number(await canvas(page).getAttribute("data-shots")), { timeout: 20_000 }).toBeGreaterThanOrEqual(spot * 2 + 1);
    if (spot === 0) {
      await expect(page.locator(".bb-power")).toHaveAttribute("data-mode", "result");
      await expect(page.locator(".bb-call")).toBeVisible();
    }
    // a tie goes to sudden death: keep shooting until it is decided
    if (spot === 4) break;
    await expect(canvas(page)).toHaveAttribute("data-spot", String(spot + 1), { timeout: 20_000 });
  }
  for (let i = 0; i < 12; i++) {
    if ((await canvas(page).getAttribute("data-matches")) === "1") break;
    if ((await canvas(page).getAttribute("data-suddenDeath")) === "true" && (await page.locator(".bb-shoot").isEnabled())) await holdShoot(page, 250);
    await page.waitForTimeout(1500);
  }
  await expect(canvas(page)).toHaveAttribute("data-matches", "1", { timeout: 30_000 });
  const end = page.getByRole("dialog", { name: "Match result" });
  await expect(end).toBeVisible();
  await expect(end.locator("h2")).toHaveText(/You win!|Bot wins/);
  await expect(end.locator(".bb-end-lines li")).toHaveCount(2);
  await insideViewport(page, end);
  // only set, aim and shoot went for the game, each a closed shape
  for (const m of sent.filter((x) => x.t === "set" || x.t === "shoot" || (x.t === "aim" && "aim" in x))) {
    if (m.t === "set") expect(Object.keys(m)).toEqual(["t"]);
    if (m.t === "aim") expect(Object.keys(m).sort()).toEqual(["aim", "t"]);
    if (m.t === "shoot") expect(Object.keys(m).sort()).toEqual(["aim", "at", "power", "t"]);
  }
});

async function newPage(browser: Browser, page: Page, testInfo: TestInfo): Promise<Page> {
  const mobile = testInfo.project.name === "mobile";
  const ctx = await browser.newContext({ viewport: page.viewportSize()!, isMobile: mobile, hasTouch: mobile });
  return ctx.newPage();
}

test("a room offers Shootout and Unlimited; a spectator sees the match with no controls", async ({ page, browser }, testInfo) => {
  test.setTimeout(90_000);
  await openBasketball(page);
  await page.getByRole("button", { name: "Create a room", exact: true }).click();
  await expect(page).toHaveURL(/#\/room\/[A-Z]{4}$/);
  await useKeyboard(page);
  const panel = page.locator(".ready-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator("[data-format]")).toHaveText(["Shootout", "Unlimited"]);
  await expect(panel.locator('[data-format="shootout"]')).toHaveAttribute("aria-checked", "true");
  await insideViewport(page, panel);
  expect(await noHorizontalScroll(page)).toBe(true);
  const code = page.url().slice(-4);

  const guest = await newPage(browser, page, testInfo);
  await guest.goto(`/#/room/${code}`);
  await useKeyboard(guest);
  for (const p of [page, guest]) await p.getByRole("button", { name: "I'm ready" }).click();
  await expect(page.locator(".ready-panel")).toBeHidden({ timeout: 15_000 });

  const watcher = await newPage(browser, page, testInfo);
  await watcher.goto(`/#/watch/${code}`);
  const badge = watcher.locator(".watch-badge");
  await expect(badge).toBeVisible({ timeout: 15_000 });
  await expect(badge.locator(".wb-count")).toHaveText(/\d+ watching/);
  await expect(watcher.getByRole("dialog", { name: /camera setup/i })).toBeHidden();
  await expect(watcher.locator(".bb-controls")).toBeHidden();
  await expect(watcher.getByRole("button", { name: /^camera$/i })).toBeHidden();
  await expect(watcher.locator(".rp-ready")).toBeHidden();
  await expect(canvas(watcher)).toHaveAttribute("data-view", "spectator");
  await expect.poll(async () => Number(await canvas(watcher).getAttribute("data-frames"))).toBeGreaterThan(10);
  await expect(watcher.locator(".hud .status")).toHaveText(/shooting/);

  // the host shoots; the watcher sees the shot land and the call
  await expect(page.locator(".hud .status")).toHaveText(/Your shot/);
  await expect(guest.locator(".hud .status")).toHaveText("Their shot, watch");
  await holdShoot(page, 250);
  await expect(canvas(watcher)).toHaveAttribute("data-shots", "1", { timeout: 15_000 });
  await expect(watcher.locator(".bb-call")).toBeVisible();
  await insideViewport(watcher, watcher.locator("canvas"));
  await insideViewport(watcher, badge);
  expect(await noHorizontalScroll(watcher)).toBe(true);
  await guest.context().close();
  await watcher.context().close();
});

test("the phone layout: the Shoot and aim buttons reachable, the canvas not clipped", async ({ page }) => {
  await openBasketball(page);
  await startPractice(page);
  const v = page.viewportSize()!;
  const c = (await canvas(page).boundingBox())!;
  expect(c.x).toBe(0);
  expect(c.y).toBe(0);
  expect(Math.round(c.width)).toBe(v.width);
  expect(Math.round(c.height)).toBe(v.height);
  for (const sel of [".bb-shoot", '[data-aim="-1"]', '[data-aim="1"]']) {
    await expect(page.locator(sel)).toBeVisible();
    await insideViewport(page, page.locator(sel));
  }
  await laidOut(page, [".bb-board", ".hud [data-action=leave]", ".bb-lower", ".bb-controls"]);
  // the aim buttons turn the arrow too
  const b = (await page.locator('[data-aim="-1"]').boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(400);
  await page.mouse.up();
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-aim"))).toBeLessThan(-0.1);
});

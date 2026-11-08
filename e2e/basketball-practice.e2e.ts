import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

// Task 38: basketball practice opens on "Just me" at both viewports: no bot,
// no shot clock, a spot or Cycle, makes / shots and the streak; "vs Bot"
// brings the shootout against the bot back. In the page, nothing sent.

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

async function startPractice(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /Basketball/ }).click();
  await expect(page.locator("#options-title")).toHaveText("Basketball");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await page.locator(".game.basketball").waitFor({ state: "attached" });
  const panel = page.getByRole("dialog", { name: /camera setup/i });
  if (await panel.isVisible().catch(() => false)) {
    await panel.getByRole("button", { name: /use keyboard instead/i }).click();
    await expect(panel).toBeHidden();
  }
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-frames"))).toBeGreaterThan(5);
}

/** Holds Space `ms`, then lets go: one shot. */
async function shoot(page: Page, ms = 300): Promise<void> {
  await expect(page.locator(".bb-shoot")).toBeEnabled({ timeout: 10_000 });
  await page.keyboard.down("Space");
  await page.waitForTimeout(ms);
  await page.keyboard.up("Space");
}

const LAYOUT = [".bb-board", ".pr-panel", ".hud [data-action=leave]", ".bb-lower", ".bb-controls"];

test("Just me: shoot alone on keys, no clock, the ball comes back; a spot sticks; vs Bot brings the bot back", async ({ page }) => {
  test.setTimeout(90_000);
  const frames: string[] = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => frames.push(String(f.payload))));
  await startPractice(page);
  const sent = frames.length;

  await expect(page.getByRole("radio", { name: "Just me" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".bb-spot")).toHaveText("Practice · Just me · Free throw · 2 pts");
  await expect(page.locator('.bb-row[data-seat="1"]')).toBeHidden();
  await expect(page.locator(".hud .status")).toHaveText(/Your shot/);
  await laidOut(page, LAYOUT);

  // aiming starts no shot clock alone
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(200);
  await page.keyboard.up("ArrowRight");
  await page.waitForTimeout(500);
  await expect(page.locator(".bb-clock")).toBeHidden();

  await shoot(page);
  await expect(canvas(page)).toHaveAttribute("data-shots", "1", { timeout: 10_000 });
  await expect(page.locator(".pr-stat")).toHaveText(/^[01]\/1 made · streak [01]/);
  await laidOut(page, [...LAYOUT, ".bb-call"]);
  // the ball comes back to you, at the next spot (Cycle), never the bot's turn
  await expect(canvas(page)).toHaveAttribute("data-spot", "1", { timeout: 10_000 });
  await expect(page.locator(".hud .status")).toHaveText(/Your shot/);

  // pick the deep spot: the next shot is from there, and stays there
  await page.locator("[data-pick=spot]").selectOption({ label: "Deep" });
  await expect(canvas(page)).toHaveAttribute("data-spot", "4");
  await shoot(page, 600);
  await expect(canvas(page)).toHaveAttribute("data-shots", "2", { timeout: 10_000 });
  await expect(page.locator(".pr-stat")).toHaveText(/\/2 made/);
  await expect(canvas(page)).toHaveAttribute("data-phase", "aim", { timeout: 10_000 });
  await expect(canvas(page)).toHaveAttribute("data-spot", "4");

  // vs Bot: the shootout from the first spot, the bot's row and its turn
  await page.getByRole("radio", { name: "vs Bot" }).click();
  await expect(page.locator(".bb-spot")).toHaveText("Practice · Spot 1 of 5 · Free throw · 2 pts");
  await expect(page.locator('.bb-row[data-seat="1"]')).toBeVisible();
  await expect(page.locator('.bb-row[data-seat="1"] .bb-name')).toHaveText("Bot");
  await expect(page.locator(".pr-stat")).toBeHidden();
  await laidOut(page, LAYOUT);
  await shoot(page);
  await expect(page.locator(".hud .status")).toHaveText("Their shot, watch", { timeout: 10_000 });

  // and back to Just me
  await page.getByRole("radio", { name: "Just me" }).click();
  await expect(page.locator('.bb-row[data-seat="1"]')).toBeHidden();
  await expect(page.locator(".hud .status")).toHaveText(/Your shot/);

  expect(frames.slice(sent).map((f) => JSON.parse(f).t).filter((t) => t !== "pong" && t !== "hello"), "practice sends nothing").toEqual([]);
});

import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

// Task 38: track practice opens on "Just me" at both viewports: your lane
// alone, race after race, your time and best, sprint or hurdles; "vs Bot"
// brings the pacer back. In the page, nothing sent.

type Box = { x: number; y: number; width: number; height: number };
const overlap = (p: Box, q: Box) => p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const canvas = (page: Page) => page.locator(".track canvas");
const num = async (page: Page, attr: string) => Number(await canvas(page).getAttribute(`data-${attr}`));

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

async function waitForGun(page: Page): Promise<void> {
  await expect.poll(() => num(page, "frames")).toBeGreaterThan(5);
  await expect(canvas(page)).toHaveAttribute("data-phase", "running", { timeout: 5_000 });
}

/** Alternating keys until the race is over, about 7 steps a second. */
async function runToTheLine(page: Page): Promise<void> {
  for (let i = 0; i < 400 && (await canvas(page).getAttribute("data-phase")) !== "over"; i++) {
    await page.keyboard.press(i % 2 ? "KeyD" : "KeyA");
    await page.waitForTimeout(140);
  }
  await expect(canvas(page)).toHaveAttribute("data-phase", "over");
}

const LAYOUT = [".hud .tr-board", ".pr-panel", ".hud [data-action=leave]", ".controls"];

test("Just me: run alone on keys to the line, your time and best; hurdles too; vs Bot brings the pacer back", async ({ page }) => {
  test.setTimeout(120_000);
  const frames: string[] = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => frames.push(String(f.payload))));
  await page.goto("/");
  await page.getByRole("button", { name: /Track/ }).click();
  await expect(page.locator("#options-title")).toHaveText("Track");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  const sent = frames.length;

  await expect(page.getByRole("radio", { name: "Just me" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".tr-board")).toContainText("Just me · Sprint · 100 m");
  await expect(page.locator(".tr-row")).toHaveCount(1);
  await expect(page.locator(".pr-stat")).toHaveText("Last – · best –");
  await waitForGun(page);
  await laidOut(page, LAYOUT);

  // the whole 100 m alone: the race ends at your finish, no one else runs
  await runToTheLine(page);
  expect(await num(page, "d1")).toBe(0);
  await expect(page.locator(".hud .status")).toHaveText(/^Your time: \d+\.\d\d s · best!$/);
  await expect(page.locator(".pr-stat")).toHaveText(/^Last \d+\.\d\d s · best \d+\.\d\d s$/);
  await laidOut(page, LAYOUT);
  // race after race
  await expect(canvas(page)).toHaveAttribute("data-phase", "set", { timeout: 10_000 });

  // hurdles alone: its own best, none yet
  await page.getByRole("radio", { name: "Hurdles" }).click();
  await expect(page.locator(".tr-board")).toContainText("Just me · Hurdles");
  await expect(page.locator(".pr-stat")).toHaveText("Last – · best –");
  await expect(page.locator(".tr-row")).toHaveCount(1);

  // vs Bot: the pacer's lane is back and it runs
  await page.getByRole("radio", { name: "vs Bot" }).click();
  await expect(page.locator(".tr-board")).toContainText("Practice · Hurdles");
  await expect(page.locator(".tr-row")).toHaveCount(2);
  await expect(page.locator(".pr-stat")).toBeHidden();
  await waitForGun(page);
  await expect.poll(() => num(page, "d1")).toBeGreaterThan(1);
  await laidOut(page, LAYOUT);

  expect(frames.slice(sent).map((f) => JSON.parse(f).t).filter((t) => t !== "pong"), "practice sends nothing").toEqual([]);
});

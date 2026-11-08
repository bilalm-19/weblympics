import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

// Task 38: bowling practice opens on "Just me" at both viewports: your frames
// alone with no clock and a running total, or "Reset pins each ball"; "vs
// Bot" brings the game against the bot back. In the page, nothing sent.

type Box = { x: number; y: number; width: number; height: number };
const overlap = (p: Box, q: Box) => p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const canvas = (page: Page) => page.locator(".bowling canvas");

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

async function startPractice(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator(".pm-button .pm-name")).not.toBeEmpty();
  await page.getByRole("button", { name: /Bowling/ }).click();
  await expect(page.locator("#options-title")).toHaveText("Bowling");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await page.locator(".game.bowling").waitFor({ state: "attached" });
  const panel = page.getByRole("dialog", { name: /camera setup/i });
  if (await panel.isVisible().catch(() => false)) {
    await panel.getByRole("button", { name: /use keyboard instead/i }).click();
    await expect(panel).toBeHidden();
  }
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-frames"))).toBeGreaterThan(5);
}

/** Holds Space for `ms`, then lets go: a throw; waits for its call. */
async function bowl(page: Page, n: number, ms = 900): Promise<void> {
  await expect(page.locator(".bowling")).toHaveAttribute("data-turn", "mine", { timeout: 20_000 });
  await page.keyboard.down("Space");
  await page.waitForTimeout(ms);
  await page.keyboard.up("Space");
  await expect(canvas(page)).toHaveAttribute("data-thrown", String(n));
  await expect(canvas(page)).toHaveAttribute("data-phase", "result", { timeout: 15_000 });
}

const LAYOUT = [".hud .bw-board", ".pr-panel", ".hud [data-action=leave]", ".hud .status", ".bw-aim", ".bw-meter", ".controls"];

test("Just me: bowl alone on keys with no clock and a running total; reset pins each ball; vs Bot brings the bot back", async ({ page }) => {
  test.setTimeout(120_000);
  const frames: string[] = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => frames.push(String(f.payload))));
  await startPractice(page);
  const sent = frames.length;

  await expect(page.getByRole("radio", { name: "Just me" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".bw-head")).toHaveText("Just me · frame 1 of 5");
  await expect(page.locator(".bw-clock")).toHaveCount(0);
  await expect(page.locator(".bw-card tr:visible")).toHaveCount(1);
  await expect(page.locator(".pr-stat")).toHaveText("Total 0");
  await laidOut(page, LAYOUT);

  // one ball: it is scored on your card, and it's your ball again (no bot between)
  await bowl(page, 1);
  await expect(page.locator(".bw-frame").first().locator("i").first()).not.toHaveText("");
  await laidOut(page, [".hud .bw-board", ".pr-panel", ".hud [data-action=leave]", ".bw-read", ".controls"]);
  await expect(page.locator(".bowling")).toHaveAttribute("data-turn", "mine", { timeout: 10_000 });
  await expect(canvas(page)).toHaveAttribute("data-turn", "0");

  // reset pins each ball: the card goes, the pins per ball count instead
  await page.getByLabel("Reset pins each ball").check();
  await expect(page.locator(".bw-head")).toHaveText("Just me · reset pins each ball");
  await expect(page.locator(".bw-card")).toBeHidden();
  await expect(page.locator(".pr-stat")).toHaveText("Pins per ball: – · 0/0 strikes");
  await bowl(page, 2);
  await expect(page.locator(".pr-stat")).toHaveText(/^Pins per ball: \d+ · last \d+ · [01]\/1 strikes$/);
  await laidOut(page, LAYOUT);

  // vs Bot: a fresh game against the bot, both rows, the shot clock
  await page.getByRole("radio", { name: "vs Bot" }).click();
  await expect(page.locator(".bw-card")).toBeVisible();
  await expect(page.locator(".bw-card tr:visible")).toHaveCount(2);
  await expect(page.locator(".bw-head")).toContainText("Practice · frame 1 of 5");
  await expect(page.locator(".bw-clock")).toBeVisible();
  await expect(page.locator(".pr-panel [data-pick=reset]")).toBeHidden();
  await laidOut(page, LAYOUT);

  expect(frames.slice(sent).map((f) => JSON.parse(f).t).filter((t) => t !== "pong"), "practice sends nothing").toEqual([]);
});

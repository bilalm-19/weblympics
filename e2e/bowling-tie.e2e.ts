import { expect, test } from "@playwright/test";
import type { Page, WebSocketRoute } from "@playwright/test";
import { VOTE_TICKS, createState, snapshot } from "../shared/games/bowling/sim.ts";
import type { BowlingSnapshot } from "../shared/games/bowling/sim.ts";

// Task 29: the tie vote (user, 2026-11-08). A level game asks both players
// "Draw, or play a tie frame?" with Draw and Continue, the 15 s clock and the
// other player's choice once made; spectators see it with no buttons. A tie
// takes a whole game to reach, so the page's socket is put through a relay:
// the server's own room (vs the bot) runs, and the relay swaps its states for
// a level game's snapshot, while everything the page sends still reaches
// the server and is recorded here.

/** Five level frames each (9 pins a frame), then the vote: the bot has voted to play on. */
function levelGame(phase: "tie-vote" | "over", ticksLeft = VOTE_TICKS): BowlingSnapshot {
  const s = createState(1);
  s.rolls = [
    [5, 4, 5, 4, 5, 4, 5, 4, 5, 4],
    [6, 3, 6, 3, 6, 3, 6, 3, 6, 3],
  ];
  s.frame = 4;
  s.phase = phase;
  s.phaseTick = VOTE_TICKS - ticksLeft;
  s.votes = [null, "continue"];
  if (phase === "over") {
    s.draw = true;
    s.winner = null;
  }
  return snapshot(s);
}

async function relay(page: Page, fake: () => BowlingSnapshot | null): Promise<Array<Record<string, unknown>>> {
  const sent: Array<Record<string, unknown>> = [];
  await page.routeWebSocket(/\/ws$/, (ws: WebSocketRoute) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => {
      sent.push(JSON.parse(String(m)));
      server.send(m);
    });
    server.onMessage((m) => {
      const msg = JSON.parse(String(m)) as { t: string };
      const f = fake();
      if (msg.t === "state" && f) ws.send(JSON.stringify({ t: "state", state: f }));
      else ws.send(m);
    });
  });
  return sent;
}

async function playVsBot(page: Page): Promise<void> {
  await page.goto("/");
  // the menu is drawn again when the server's welcome arrives: wait for it (the profile button's name)
  await expect(page.locator(".pm-button .pm-name")).not.toBeEmpty();
  await page.getByRole("button", { name: /Bowling/ }).click();
  await page.getByRole("button", { name: "Play vs bot" }).click();
  const panel = page.getByRole("dialog", { name: /camera setup/i });
  if (await panel.isVisible().catch(() => false)) await panel.getByRole("button", { name: /use keyboard instead/i }).click();
  await expect(page.locator(".bowling canvas")).toBeVisible();
}

test("a level game: both see the question, Draw and Continue, the clock and the other's choice; the vote is sent", async ({ page }) => {
  let snap: BowlingSnapshot | null = null;
  const sent = await relay(page, () => snap);
  await playVsBot(page);
  snap = levelGame("tie-vote", 12 * 60);
  const vote = page.locator(".bw-vote");
  await expect(vote).toBeVisible();
  await expect(vote.getByRole("heading")).toHaveText("Level! Draw, or play a tie frame?");
  await expect(vote.locator(".bw-vote-clock")).toHaveText(/^12 s to choose/);
  await expect(vote.locator(".bw-vote-state")).toContainText("Bot: play on");
  await expect(vote.locator(".bw-vote-state")).toContainText("You: deciding…");
  const draw = vote.getByRole("button", { name: /draw/i });
  const cont = vote.getByRole("button", { name: /continue/i });
  for (const b of [draw, cont]) {
    await expect(b).toBeVisible();
    const box = (await b.boundingBox())!;
    const v = page.viewportSize()!;
    expect(box.x + box.width).toBeLessThanOrEqual(v.width);
    expect(box.y + box.height).toBeLessThanOrEqual(v.height);
  }
  // the totals are level on the board
  await expect(page.locator(".bw-total")).toHaveText(["45", "45"]);
  await cont.click();
  await expect.poll(() => sent.filter((m) => m.t === "tie")).toEqual([{ t: "tie", choice: "continue" }]);
  await expect(vote.locator(".bw-vote-state")).toContainText("You: play on");
  await expect(draw).toBeDisabled();
  // one vote: the key does nothing more
  await page.keyboard.press("KeyD");
  await page.waitForTimeout(200);
  expect(sent.filter((m) => m.t === "tie")).toHaveLength(1);
});

test("D votes draw from the keyboard, and a drawn game's end card says Draw", async ({ page }) => {
  let snap: BowlingSnapshot | null = null;
  const sent = await relay(page, () => snap);
  await playVsBot(page);
  snap = levelGame("tie-vote");
  await expect(page.locator(".bw-vote")).toBeVisible();
  await page.keyboard.press("KeyD");
  await expect.poll(() => sent.filter((m) => m.t === "tie")).toEqual([{ t: "tie", choice: "draw" }]);
  snap = levelGame("over");
  await expect(page.locator(".bw-vote")).toBeHidden();
  await expect(page.locator(".bw-end")).toBeVisible();
  await expect(page.locator(".bw-end-title")).toHaveText("Draw");
  await expect(page.locator(".bw-end-score")).toHaveText("You 45 · Bot 45");
});

test("a spectator sees the vote and both choices, with no buttons", async ({ page, browser }, testInfo) => {
  test.setTimeout(60_000);
  await page.goto("/");
  // the menu is drawn again when the server's welcome arrives: wait for it (the profile button's name)
  await expect(page.locator(".pm-button .pm-name")).not.toBeEmpty();
  await page.getByRole("button", { name: /Bowling/ }).click();
  await page.getByRole("button", { name: "Create a room" }).click();
  await expect(page).toHaveURL(/#\/room\/[A-Z]{4}$/);
  const code = page.url().slice(-4);
  const mobile = testInfo.project.name === "mobile";
  const ctx = await browser.newContext({ viewport: page.viewportSize()!, isMobile: mobile, hasTouch: mobile });
  const watcher = await ctx.newPage();
  const snap = levelGame("tie-vote");
  await relay(watcher, () => snap);
  await watcher.goto(`/#/watch/${code}`);
  await expect(watcher.locator(".watch-badge")).toBeVisible();
  const vote = watcher.locator(".bw-vote");
  await expect(vote).toBeVisible();
  await expect(vote.getByRole("heading")).toHaveText("Level! Draw, or play a tie frame?");
  await expect(vote.locator(".bw-vote-state")).toContainText(": play on");
  await expect(vote.getByRole("button")).toHaveCount(0);
  await ctx.close();
});

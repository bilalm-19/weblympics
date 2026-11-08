import { expect, test } from "@playwright/test";
import type { Browser, Page, TestInfo } from "@playwright/test";
import { skipCheck, useKeyboard } from "./flow.ts";

// Task 16: after each point the umpire's call goes across the top in bold
// ("15-Love", "Deuce", "Game"), clear of the court and every other HUD
// piece, and the players react: the winner sparkles and pumps a fist, the
// loser gets a scribble. All drawn from the snapshot each screen already gets,
// so spectators see it too and nothing new is sent. The wording table is
// spec/point-call.test.ts. In practice nobody swings here, so points come on
// their own (unreturned serves, the bot's returns).

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const CALL = /^(Love-15|15-Love|15-all|30-Love|Love-30|30-15|15-30|40-Love|Love-40|30-all|40-15|15-40|40-30|30-40|Deuce|Advantage .+|Game|Set|Game, set, match|Fault|Double fault)$/;

/**
 * The banner is up, inside the viewport, and covers neither the court nor any
 * other HUD piece showing. Measured in one go in the page, so a call that ends
 * mid-check can't leave half the measurements from after it.
 */
async function bannerClear(page: Page): Promise<void> {
  // on a starved machine a call can end between "visible" and the measurement:
  // then wait for the next call and measure that one
  const measure = () => page.evaluate(() => {
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    };
    const banner = document.querySelector(".call-banner") as HTMLElement;
    const sels = [".hud .score", ".hud button", ".hud .tracking", ".cam-dock", ".aid", ".controls", ".shot-label", ".stroke", ".ready-panel"];
    const others = sels.flatMap((sel) =>
      [...document.querySelectorAll(sel)]
        .filter((el) => (el as HTMLElement).checkVisibility?.() ?? true)
        .map((el) => ({ sel, box: rect(el) }))
        .filter((o) => o.box.width > 0 && o.box.height > 0),
    );
    return {
      shown: !banner.hidden,
      box: rect(banner),
      court: (document.querySelector("canvas") as HTMLCanvasElement).dataset.court!,
      others,
      vw: window.innerWidth,
      vh: window.innerHeight,
      scroll: document.documentElement.scrollWidth <= window.innerWidth,
    };
  });
  let m = await measure();
  for (let i = 0; i < 3 && !m.shown; i++) {
    await expect(page.locator(".call-banner")).toBeVisible({ timeout: 40_000 });
    m = await measure();
  }
  expect(m.shown, "banner still up when measured").toBe(true);
  const { box } = m;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(m.vw);
  expect(box.y + box.height).toBeLessThanOrEqual(m.vh);
  const [l, t, r, b] = m.court.split(",").map(Number);
  expect(overlaps(box, { x: l, y: t, width: r - l, height: b - t }), "banner covers the court").toBe(false);
  for (const o of m.others) expect(overlaps(box, o.box), `banner covers ${o.sel}`).toBe(false);
  expect(m.scroll).toBe(true);
}

async function practice(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /practice vs bot/i }).click();
  await useKeyboard(page);
  await expect(page.locator("canvas")).toBeVisible();
}

/** Waits for the next point (not a first-serve fault) and returns its call. */
async function nextPoint(page: Page): Promise<string> {
  const call = page.locator(".call-banner .cb-call");
  await expect(call).toHaveText(/^(?!Fault$).+/, { timeout: 40_000 });
  return (await call.textContent()) ?? "";
}

test("a point is called across the top in tennis words, clear of the court and the HUD, and read out", async ({ page }) => {
  test.setTimeout(90_000);
  await practice(page);
  const banner = page.locator(".call-banner");
  await expect(banner).toHaveAttribute("role", "status");
  await expect(banner).toHaveAttribute("aria-live", "polite");
  const said = await nextPoint(page);
  expect(said).toMatch(CALL);
  // the first point of the match: 15-Love one way or the other, or a double fault
  expect(said).toMatch(/^(15-Love|Love-15|Double fault)$/);
  await expect(banner.locator(".cb-detail")).toHaveText(/^(You win the point|Bot wins the point|15-Love|Love-15)$/);
  await bannerClear(page);
  // bold and big: bigger than the score bar's numbers
  const size = await banner.locator(".cb-call").evaluate((el) => [parseFloat(getComputedStyle(el).fontSize), Number(getComputedStyle(el).fontWeight)]);
  const barSize = await page.locator(".hud .score .sb-points").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(size[0]).toBeGreaterThan(barSize * 1.4);
  expect(size[1]).toBeGreaterThanOrEqual(700);
  // the players react on this screen: the winner cheers, the loser is frustrated
  const canvas = page.locator("canvas");
  const r0 = await canvas.getAttribute("data-react0");
  const r1 = await canvas.getAttribute("data-react1");
  expect([r0, r1].sort()).toEqual(["cheer:0", "frustrated:0"]);
  // it clears, and the reactions end
  await expect(banner).toBeHidden({ timeout: 5000 });
  await expect.poll(() => canvas.getAttribute("data-react0"), { timeout: 5000 }).toBe("");
});

test("the banner stays clear of the camera preview and its labels", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByRole("button", { name: /practice vs bot/i }).click();
  const panel = page.getByRole("dialog", { name: /camera setup/i });
  await panel.getByRole("button", { name: "Got it" }).click();
  await panel.getByRole("button", { name: /start camera/i }).click();
  await expect(panel.getByRole("heading", { name: /can we see you/i })).toBeVisible({ timeout: 40_000 });
  await skipCheck(page);
  await expect(page.locator("video.selfview")).toBeVisible();
  await nextPoint(page);
  await bannerClear(page);
});

async function seat(browser: Browser, page: Page, testInfo: TestInfo): Promise<Page> {
  const mobile = testInfo.project.name === "mobile";
  const ctx = await browser.newContext({ viewport: page.viewportSize()!, isMobile: mobile, hasTouch: mobile });
  const p = await ctx.newPage();
  await p.goto(page.url());
  return p;
}

test("both seats and a spectator see the same call and the same reactions; nothing new is sent", async ({ page, browser }, testInfo) => {
  test.setTimeout(150_000);
  const sent: string[] = [];
  const watch = (p: Page) => p.on("websocket", (ws) => ws.on("framesent", (f) => sent.push(JSON.parse(String(f.payload)).t)));
  watch(page);
  await page.goto("/");
  await page.getByRole("button", { name: /create a room/i }).click();
  await expect(page).toHaveURL(/#\/room\/[A-Z]{4}$/);
  await useKeyboard(page);
  const guest = await seat(browser, page, testInfo);
  watch(guest);
  await useKeyboard(guest);
  const spectator = await seat(browser, page, testInfo);
  watch(spectator);
  // a spectator gets no camera setup (it never plays)
  await expect(spectator.getByRole("region", { name: /match setup/i })).toContainText(/spectating/i, { timeout: 20_000 });
  await expect(spectator.getByRole("dialog", { name: /camera setup/i })).toBeHidden();

  await guest.getByRole("button", { name: "I'm ready" }).click();
  await page.getByRole("button", { name: "I'm ready" }).click();
  await expect(page.getByRole("region", { name: /match setup/i })).toBeHidden({ timeout: 8000 });

  // nobody swings: the serve goes unreturned (15-Love to the host, who serves) or double-faults
  const calls = await Promise.all([page, guest, spectator].map((p) => nextPoint(p)));
  expect(calls[0]).toMatch(/^(15-Love|Double fault)$/);
  expect(calls[1]).toBe(calls[0]);
  expect(calls[2]).toBe(calls[0]);
  // the same reactions on every screen, one cheering and one frustrated
  const reacts = await Promise.all(
    [page, guest, spectator].map(async (p) => {
      const c = p.locator("canvas");
      return `${await c.getAttribute("data-react0")} ${await c.getAttribute("data-react1")}`;
    }),
  );
  expect(reacts[0]).toMatch(/^(cheer:0 frustrated:0|frustrated:0 cheer:0)$/);
  expect(reacts[1]).toBe(reacts[0]);
  expect(reacts[2]).toBe(reacts[0]);
  // who took it: "You" on the winner's screen, the name on the others'
  const hostWon = reacts[0].startsWith("cheer");
  const youWin = hostWon ? page : guest;
  const other = hostWon ? guest : page;
  if (calls[0] === "15-Love") {
    await expect(youWin.locator(".call-banner .cb-detail")).toHaveText("You win the point");
    await expect(other.locator(".call-banner .cb-detail")).toHaveText(/^.+ wins the point$/);
    await expect(spectator.locator(".call-banner .cb-detail")).toHaveText(/^.+ wins the point$/);
  }
  await bannerClear(page);
  await bannerClear(spectator);

  // the reactions and the call are drawn from the snapshot: only the usual messages went out
  // task 34 added presence ("idle", "status"), never game data
  const allowed = new Set(["hello", "create", "join", "ready", "format", "move", "mode", "swing", "pause", "leave", "pong", "idle", "status"]);
  expect(sent.filter((t) => !allowed.has(t))).toEqual([]);
  await guest.context().close();
  await spectator.context().close();
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the call still shows, without the pop-in; the reactions still show, standing still", async ({ page }) => {
    test.setTimeout(90_000);
    await practice(page);
    await nextPoint(page);
    const banner = page.locator(".call-banner");
    expect(await banner.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    const canvas = page.locator("canvas");
    expect([await canvas.getAttribute("data-react0"), await canvas.getAttribute("data-react1")].sort()).toEqual(["cheer:0", "frustrated:0"]);
  });
});

test("with motion allowed, the call pops in", async ({ page }) => {
  test.setTimeout(90_000);
  await practice(page);
  await nextPoint(page);
  expect(await page.locator(".call-banner").evaluate((el) => getComputedStyle(el).animationName)).toBe("cb-pop");
});

test("training keeps no score, so no call", async ({ page }) => {
  await page.goto("/#/train");
  await useKeyboard(page);
  await expect(page.locator(".coach")).toBeVisible();
  await expect(page.locator(".call-banner")).toHaveCount(0);
});

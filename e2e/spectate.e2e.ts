import { expect, test } from "@playwright/test";
import type { Browser, Page, TestInfo } from "@playwright/test";
import WebSocket from "ws";
import { useKeyboard } from "./flow.ts";

// Task 24 at both viewports: the watch link spectates even with a seat free,
// a watcher sees the match with a "Watching" badge, both names and the count,
// and has no camera, ready button or controls; the 11th watcher is told the
// match is full of watchers (user, 2026-11-05: a cap of 10).

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function newPage(browser: Browser, page: Page, testInfo: TestInfo): Promise<Page> {
  const mobile = testInfo.project.name === "mobile";
  const ctx = await browser.newContext({ viewport: page.viewportSize()!, isMobile: mobile, hasTouch: mobile });
  return ctx.newPage();
}

async function insideViewport(page: Page, selector: string): Promise<void> {
  const v = page.viewportSize()!;
  const b = (await page.locator(selector).first().boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(v.width);
  expect(b.y + b.height).toBeLessThanOrEqual(v.height);
}

async function createRoom(page: Page, sport?: RegExp): Promise<string> {
  await page.goto("/");
  if (sport) await page.getByRole("button", { name: sport }).click();
  await page.getByRole("button", { name: /create a room/i }).click();
  await expect(page).toHaveURL(/#\/room\/[A-Z]{4}$/);
  // tennis and track open the camera setup first (task 15); archery waits for the Camera button
  if (!sport || /Track/.test(sport.source)) await useKeyboard(page);
  return page.url().slice(-4);
}

/** A watcher with no controls, camera or ready button, inside the viewport. */
async function expectWatching(watcher: Page, names: RegExp): Promise<void> {
  const badge = watcher.locator(".watch-badge");
  await expect(badge).toBeVisible({ timeout: 15_000 });
  await expect(badge).toContainText("Watching");
  await expect(badge.locator(".wb-names")).toHaveText(names);
  await expect(badge.locator(".wb-count")).toHaveText(/\d+ watching/);
  await expect(watcher.getByRole("dialog", { name: /camera setup/i })).toBeHidden();
  await expect(watcher.locator(".controls")).toBeHidden();
  await expect(watcher.getByRole("button", { name: /^camera$/i })).toBeHidden();
  await expect(watcher.locator(".rp-ready")).toBeHidden();
  await expect(watcher.getByRole("button", { name: /copy invite/i })).toBeHidden();
  await expect(watcher.getByRole("button", { name: /copy watch link/i })).toBeVisible();
  await insideViewport(watcher, ".watch-badge");
  await insideViewport(watcher, "canvas");
  expect(await noHorizontalScroll(watcher)).toBe(true);
}

test("a watch link spectates even with a seat free; the invite link still seats a player", async ({ page, browser }, testInfo) => {
  test.setTimeout(90_000);
  const code = await createRoom(page);

  // the player's HUD offers the watch link next to the invite
  const copyWatch = page.getByRole("button", { name: /copy watch link/i });
  await expect(copyWatch).toBeVisible();
  await expect(page.getByRole("button", { name: /copy invite/i })).toBeVisible();
  await insideViewport(page, "[data-action=copy-watch]");
  await expect(copyWatch).toHaveAttribute("data-link", new RegExp(`/#/watch/${code}$`));

  const watcher = await newPage(browser, page, testInfo);
  await watcher.goto(`/#/watch/${code}`);
  await expectWatching(watcher, /vs Open seat$/);
  await expect(watcher).toHaveURL(new RegExp(`#/watch/${code}$`));
  await expect(watcher.locator(".wb-count")).toHaveText("· 1 watching");
  // the seat stayed free: the plain invite takes it
  const guest = await newPage(browser, page, testInfo);
  await guest.goto(`/#/room/${code}`);
  await expect(guest.getByRole("dialog", { name: /camera setup/i })).toBeVisible();
  await useKeyboard(guest);
  await expect(guest.locator(".watch-badge")).toHaveCount(0);
  await expect(watcher.locator(".wb-names")).not.toContainText("Open seat");

  // both ready: the watcher sees the match start and play, still with no controls
  for (const p of [page, guest]) await p.getByRole("button", { name: "I'm ready" }).click();
  await expect(watcher.locator(".game")).toHaveAttribute("data-phase", "playing", { timeout: 15_000 });
  await expect(watcher.locator(".score")).toBeVisible();
  await expect.poll(async () => Number(await watcher.locator("canvas").getAttribute("data-frames"))).toBeGreaterThan(10);
  await expectWatching(watcher, / vs /);
  await guest.context().close();
  await watcher.context().close();
});

test("archery and track: a watcher arriving mid-match gets the state at once, with no controls", async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000);
  for (const sport of [/Archery/, /Track/]) {
    const code = await createRoom(page, sport);
    const guest = await newPage(browser, page, testInfo);
    await guest.goto(`/#/room/${code}`);
    if (sport.source === "Track") await useKeyboard(guest);
    for (const p of [page, guest]) await p.getByRole("button", { name: "I'm ready" }).click();
    await expect(page.locator(".ready-panel")).toBeHidden({ timeout: 15_000 });
    const watcher = await newPage(browser, page, testInfo);
    await watcher.goto(`/#/watch/${code}`);
    await expectWatching(watcher, / vs /);
    await expect(watcher.locator(".ready-panel")).toBeHidden();
    await guest.context().close();
    await watcher.context().close();
    await page.getByRole("button", { name: "Leave" }).click();
  }
});

/** A guest's socket that watches `code` by the watch link; the room keeps it while it is open. */
async function socketWatcher(baseURL: string, code: string): Promise<WebSocket> {
  const res = await fetch(new URL("/api/me", baseURL));
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("wl_guest="))!.split(";")[0];
  const url = new URL("/ws", baseURL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(url, { headers: { cookie } });
  await new Promise<void>((resolve, reject) => {
    ws.on("message", (data) => {
      const m = JSON.parse(String(data)) as { t: string };
      if (m.t === "welcome") ws.send(JSON.stringify({ t: "join", room: code, watch: true }));
      if (m.t === "room") resolve();
      if (m.t === "error") reject(new Error(String(data)));
    });
    ws.once("open", () => ws.send(JSON.stringify({ t: "hello" })));
    ws.once("error", reject);
  });
  return ws;
}

test("ten watchers at most: the eleventh is told the match is full of watchers", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(90_000);
  const code = await createRoom(page);
  const sockets: WebSocket[] = [];
  try {
    for (let i = 0; i < 9; i++) sockets.push(await socketWatcher(baseURL!, code));
    // the tenth watcher is a page, and fits
    const tenth = await newPage(browser, page, testInfo);
    await tenth.goto(`/#/watch/${code}`);
    await expect(tenth.locator(".wb-count")).toHaveText("· 10 watching", { timeout: 15_000 });

    const eleventh = await newPage(browser, page, testInfo);
    await eleventh.goto(`/#/watch/${code}`);
    await expect(eleventh.getByRole("alert")).toHaveText(/full of watchers/i, { timeout: 15_000 });
    await expect(eleventh.locator(".watch-badge")).toHaveCount(0);
    // back on the home screen, with the link cleared from the address bar
    await expect(eleventh).not.toHaveURL(/#\/watch\//);
    expect(await noHorizontalScroll(eleventh)).toBe(true);
    await tenth.context().close();
    await eleventh.context().close();
  } finally {
    for (const ws of sockets) ws.close();
  }
});

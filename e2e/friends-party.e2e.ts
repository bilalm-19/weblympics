import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { befriend, person } from "./friends-flow.ts";
import type { Person } from "./friends-flow.ts";
import { useKeyboard } from "./flow.ts";

// Task 34 at both viewports: a party plays and rotates. Three friends in a
// party; the leader picks track and "winner stays on" and starts: the first
// two sit in a fresh room, the third watches with a Watching badge and the
// compact party strip (never over the court). The race is run on keys; the
// winner stays on, the next member comes in for the next match. Also: from a
// room, "Invite friends" sends the room itself and Join seats the friend.

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const partyPanel = (page: Page) => page.getByRole("dialog", { name: "Party" });

async function inView(page: Page, selector: string): Promise<void> {
  const v = page.viewportSize()!;
  const b = (await page.locator(selector).first().boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(v.width + 0.5);
  expect(b.y + b.height).toBeLessThanOrEqual(v.height + 0.5);
}

/** Alternating A/D for `ms`, about 7 steps a second. */
async function run(page: Page, ms: number): Promise<void> {
  for (let t = 0, i = 0; t < ms; t += 140, i++) {
    await page.keyboard.press(i % 2 ? "KeyD" : "KeyA");
    await page.waitForTimeout(140);
  }
}

test("a party of three plays track: two race, one watches; the winner stays on and the next comes in", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(240_000);
  const ana = await person(browser, page, testInfo, baseURL!, "Ana");
  const ben = await person(browser, page, testInfo, baseURL!, "Ben");
  const cyd = await person(browser, page, testInfo, baseURL!, "Cyd");
  await befriend(ana, ben);
  await befriend(ana, cyd);
  for (const p of [ana, ben, cyd]) await p.page.goto("/");

  // Ana starts a party from the friends panel and makes it public to her friends
  await ana.page.getByRole("button", { name: /^Friends/ }).click();
  await ana.page.getByRole("button", { name: "Start a party" }).click();
  const ap = partyPanel(ana.page);
  await expect(ap).toContainText(/your party · 1 of 10/i);
  await ap.getByRole("radio", { name: "Public to friends" }).click();
  await expect(ap.getByRole("radio", { name: "Public to friends" })).toHaveAttribute("aria-checked", "true");

  // Ben and Cyd see it in their friends list and join
  for (const p of [ben, cyd]) {
    await p.page.getByRole("button", { name: /^Friends/ }).click();
    await p.page.getByRole("button", { name: `Join ${ana.tag}'s party` }).click();
    await expect(partyPanel(p.page)).toContainText(/your party · \d of 10/i);
  }
  await expect(ap).toContainText(/your party · 3 of 10/i);
  // every member shown, the leader crowned, who plays next
  const members = ap.getByRole("list", { name: "Members" });
  await expect(members.getByRole("listitem")).toHaveCount(3);
  await expect(members.getByRole("listitem").first()).toContainText("(you)");
  await expect(members.locator(".pt-crown")).toHaveCount(1);
  await expect(ap.locator(".pt-next")).toHaveText(new RegExp(`Next: ${ana.name} vs ${ben.name}`));
  // a member can't change anything
  await expect(partyPanel(cyd.page).getByRole("radiogroup")).toHaveCount(0);
  await expect(partyPanel(cyd.page).getByRole("button", { name: /start the match/i })).toHaveCount(0);
  const box = (await ap.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 0.5);
  expect(await noHorizontalScroll(ana.page)).toBe(true);

  await ap.getByRole("combobox", { name: "Game" }).selectOption("track");
  await expect(partyPanel(ben.page)).toContainText(/^.*Track · Next/);
  await expect(ap.getByRole("radio", { name: "Winner stays on" })).toHaveAttribute("aria-checked", "true");
  await ap.getByRole("button", { name: "Start the match" }).click();

  // Ana and Ben sit; Cyd watches, with the compact strip in the HUD's row; the panels have closed
  for (const p of [ana, ben, cyd]) {
    await expect(p.page).toHaveURL(/#\/(room|watch)\/[A-Z]{4}$/);
    await expect(partyPanel(p.page)).toBeHidden();
  }
  await expect(cyd.page.locator(".watch-badge")).toBeVisible();
  await expect(cyd.page.locator(".party-strip")).toContainText(`Next: ${ana.name} vs ${ben.name}`);
  for (const p of [ana, cyd]) {
    await inView(p.page, ".party-strip");
    expect(await noHorizontalScroll(p.page)).toBe(true);
  }
  await expect(ana.page.locator(".party-strip")).toBeVisible();

  // both ready (past the camera setup a seated player gets first, task 15), then Ben runs and Ana doesn't: Ben wins
  for (const p of [ana, ben]) await useKeyboard(p.page);
  for (const p of [ana, ben]) await p.page.getByRole("button", { name: "I'm ready" }).click();
  await expect(ben.page.locator(".track canvas")).toHaveAttribute("data-phase", "running", { timeout: 15_000 });
  await ben.page.locator(".track canvas").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await run(ben.page, 24_000);
  // the race ends 5 s after Ben crosses (Ana never does); the strip turns to the next pair
  await expect(cyd.page.locator(".party-strip")).toContainText(`Next: ${ben.name} vs ${cyd.name}`, { timeout: 20_000 });
  await ana.page.locator(".party-strip").getByRole("button", { name: /^Party: 3 members/ }).click();
  await expect(partyPanel(ana.page).locator(".pt-last")).toHaveText(`${ben.name} won the last match.`);
  // the leader starts the next match: Ben and Cyd sit, Ana watches
  await partyPanel(ana.page).getByRole("button", { name: "Start the next match" }).click();
  await expect(ana.page.locator(".watch-badge")).toBeVisible({ timeout: 10_000 });
  for (const p of [cyd, ben]) {
    await useKeyboard(p.page);
    await expect(p.page.getByRole("button", { name: "I'm ready" })).toBeVisible();
  }
  for (const p of [ana, ben, cyd]) await p.page.context().close();
});

test("from a room, Invite friends sends that room; Join seats the friend", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(150_000);
  const ana: Person = await person(browser, page, testInfo, baseURL!, "Ana");
  const ben: Person = await person(browser, page, testInfo, baseURL!, "Ben");
  await befriend(ana, ben);
  await ana.page.goto("/");
  await ben.page.goto("/");
  await ana.page.getByRole("button", { name: /Track/ }).click();
  await ana.page.getByRole("button", { name: /create a room/i }).click();
  await expect(ana.page).toHaveURL(/#\/room\/[A-Z]{4}$/);
  await useKeyboard(ana.page);
  const code = ana.page.url().slice(-4);
  await inView(ana.page, ".party-strip");
  await ana.page.locator(".party-strip").getByRole("button", { name: "Invite friends" }).click();
  await ana.page.getByRole("dialog", { name: "Friends" }).getByRole("button", { name: `Invite ${ben.tag} to your match` }).click();
  const toast = ben.page.getByRole("alertdialog", { name: `Invite from ${ana.name}` });
  await expect(toast).toContainText(`${ana.name} invites you to Track. Join?`);
  await toast.getByRole("button", { name: "Join" }).click();
  await expect(ben.page).toHaveURL(new RegExp(`#/room/${code}$`));
  await useKeyboard(ben.page);
  await expect(ben.page.getByRole("button", { name: "I'm ready" })).toBeVisible();
  for (const p of [ana, ben]) await p.page.context().close();
});

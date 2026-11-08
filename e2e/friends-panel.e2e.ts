import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { befriend, person } from "./friends-flow.ts";

// Task 34 at both viewports: the Friends button beside the profile button;
// a guest is told why they can't add friends; adding by Name#1234 sends a
// request that arrives on the other's open page at once (no reload), Accept
// makes friends, status shows live, "show me as" offline hides you; an
// invite pops up and Join takes the friend into the room. Panels fit the
// screen and nothing scrolls sideways.

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function fits(page: Page, box: Locator): Promise<void> {
  await expect(box).toBeVisible();
  const b = (await box.boundingBox())!;
  const v = page.viewportSize()!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(v.width + 0.5);
  expect(b.y + b.height).toBeLessThanOrEqual(v.height + 0.5);
  expect(await noHorizontalScroll(page)).toBe(true);
}

const friendsButton = (page: Page) => page.getByRole("button", { name: /^Friends/ });

/** Nothing in the top-right corner (Friends, Party, profile) sits over the logo. */
async function expectClearOfLogo(page: Page): Promise<void> {
  type Box = { x: number; y: number; width: number; height: number };
  const overlaps = (a: Box, c: Box) => a.x < c.x + c.width && c.x < a.x + a.width && a.y < c.y + c.height && c.y < a.y + a.height;
  for (const part of [".logo-rings", ".logo-word"]) {
    const logo = (await page.locator(part).boundingBox())!;
    for (const b of await page.locator(".menu-corner button:visible").all()) {
      expect(overlaps((await b.boundingBox())!, logo), `${await b.getAttribute("class")} over ${part}`).toBe(false);
    }
  }
}
const panel = (page: Page) => page.getByRole("dialog", { name: "Friends" });

test("a guest sees the Friends button and is told plainly why they can't add friends", async ({ page }) => {
  await page.goto("/");
  const button = friendsButton(page);
  await expect(button).toBeVisible();
  // beside the profile button, top right, a comfortable tap target
  const b = (await button.boundingBox())!;
  const p = (await page.locator(".pm-button").boundingBox())!;
  expect(b.x + b.width).toBeLessThanOrEqual(p.x + 1);
  expect(Math.abs(b.y + b.height / 2 - (p.y + p.height / 2))).toBeLessThan(6);
  expect(b.height).toBeGreaterThanOrEqual(44);
  await expectClearOfLogo(page);
  await button.click();
  await expect(panel(page)).toContainText(/guests can't add friends/i);
  await expect(panel(page)).toContainText(/passkey/i);
  await fits(page, panel(page));
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect(button).toBeFocused();
});

test("add by Name#1234: the request arrives live, Accept makes friends, status and 'appear offline' show at once", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(150_000);
  const ana = await person(browser, page, testInfo, baseURL!, "Ana");
  const ben = await person(browser, page, testInfo, baseURL!, "Ben");
  await ana.page.goto("/");
  await ben.page.goto("/");

  // Ana's own tag shows in her panel; she adds Ben by his
  await friendsButton(ana.page).click();
  const ap = panel(ana.page);
  await expect(ap.locator(".fr-me-tag")).toHaveText(ana.tag);
  await fits(ana.page, ap);
  // a wrong number is refused plainly
  await ap.getByRole("textbox").fill(ben.tag.replace(/#(\d)/, (_, d: string) => `#${(Number(d) + 1) % 10}`));
  await ap.getByRole("button", { name: "Add", exact: true }).click();
  await expect(ap.getByRole("status")).toHaveText(/no account has that name and number/i);
  await ap.getByRole("textbox").fill(ben.tag);
  await ap.getByRole("button", { name: "Add", exact: true }).click();
  await expect(ap.getByRole("status")).toHaveText(/request sent/i);

  // Ben sees it without reloading: a badge on the button, then the request
  await expect(friendsButton(ben.page)).toHaveAccessibleName(/1 request/);
  await friendsButton(ben.page).click();
  const bp = panel(ben.page);
  const req = bp.getByRole("list", { name: "Requests" });
  await expect(req).toContainText(ana.name);
  await expect(req).toContainText(ana.tag.split("#")[1]);
  await fits(ben.page, bp);
  await bp.getByRole("button", { name: `Accept ${ana.tag}` }).click();
  // both lists now show the other, online
  await expect(bp.getByRole("list", { name: "Online" })).toContainText(ana.name);
  await expect(friendsButton(ben.page)).toHaveAccessibleName(/1 online$/);
  await expect(ap.getByRole("list", { name: "Online" })).toContainText(ben.name);
  await expect(friendsButton(ana.page)).toHaveAccessibleName(/1 online/);

  // Ben appears offline: Ana sees him move to Offline at once
  await bp.getByRole("button", { name: "Offline" }).click();
  await expect(bp.getByRole("button", { name: "Offline" })).toHaveAttribute("aria-pressed", "true");
  await expect(ap.getByRole("list", { name: "Offline" })).toContainText(ben.name);
  await expect(friendsButton(ana.page)).toHaveAccessibleName(/0 online/);
  // and it holds across a reload of Ben's page
  await ben.page.reload();
  await expect(friendsButton(ben.page)).toBeVisible();
  await ben.page.waitForTimeout(800);
  await expect(ap.getByRole("list", { name: "Offline" })).toContainText(ben.name);
  await friendsButton(ben.page).click();
  await expect(panel(ben.page).getByRole("button", { name: "Offline" })).toHaveAttribute("aria-pressed", "true");
  await panel(ben.page).getByRole("button", { name: "Online" }).click();
  await expect(ap.getByRole("list", { name: "Online" })).toContainText(ben.name);
  await ana.page.context().close();
  await ben.page.context().close();
});

test("a party invite pops up on a friend's screen; Join puts them in the party", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(150_000);
  const ana = await person(browser, page, testInfo, baseURL!, "Ana");
  const ben = await person(browser, page, testInfo, baseURL!, "Ben");
  await befriend(ana, ben);
  await ana.page.goto("/");
  await ben.page.goto("/");
  await friendsButton(ana.page).click();
  const ap = panel(ana.page);
  await ap.getByRole("button", { name: `Invite ${ben.tag} to your party` }).click();
  await expect(ap.getByRole("button", { name: `Invite ${ben.tag} to your party` })).toHaveText(/invited/i);

  const toast = ben.page.getByRole("alertdialog", { name: `Invite from ${ana.name}` });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText(`${ana.name} invites you to their party`);
  await fits(ben.page, toast);
  await toast.getByRole("button", { name: "Join" }).click();
  // Ben is in Ana's party: both see two members
  await expect(ben.page.getByRole("dialog", { name: "Party" })).toContainText(/your party · 2 of 10/i);
  await expect(ap.getByRole("button", { name: /your party · 2 of 10/i })).toBeVisible();
  await ap.getByRole("button", { name: "Close friends" }).click();
  // the Party button beside Friends (desktop; on a phone the panel holds it), never over the logo
  if (page.viewportSize()!.width > 560) await expect(ana.page.getByRole("button", { name: /your party: 2 of 10/i })).toBeVisible();
  await expectClearOfLogo(ana.page);
  await ana.page.context().close();
  await ben.page.context().close();
});

test("a friend link makes two people friends in one click", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(150_000);
  const ana = await person(browser, page, testInfo, baseURL!, "Ana");
  const ben = await person(browser, page, testInfo, baseURL!, "Ben");
  const { code } = (await ana.post("/api/friends/link")) as { code: string };
  await ana.page.goto("/");
  await ben.page.goto(`/#/friend/${code}`);
  await expect(ben.page).toHaveURL(/\/$/);
  await friendsButton(ben.page).click();
  await expect(panel(ben.page).getByRole("list", { name: "Online" })).toContainText(ana.name);
  await ana.page.context().close();
  await ben.page.context().close();
});

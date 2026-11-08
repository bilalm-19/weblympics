import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { useKeyboard } from "./flow.ts";

// Task 34, amended by the user (2026-11-08): guests may start, lead and share
// a party by its link. At both viewports: a guest starts a party from the
// friends panel, sees no Name#1234 invite box or friends list, only "Copy
// party link"; a second guest opens the link and joins; leaving and opening
// the link again rejoins; the guest leader starts a match and both sit.

const partyPanel = (page: Page) => page.getByRole("dialog", { name: "Party" });
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function guestContext(page: Page, browser: import("@playwright/test").Browser, mobile: boolean, baseURL: string): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: page.viewportSize()!, isMobile: mobile, hasTouch: mobile });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(baseURL).origin });
  return ctx;
}

test("a guest starts a party, copies its link; another guest opens it and joins; the guest leader starts a match", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const mobile = testInfo.project.name === "mobile";
  const leadCtx = await guestContext(page, browser, mobile, baseURL!);
  const lead = await leadCtx.newPage();
  await lead.goto("/");
  await lead.getByRole("button", { name: /^Friends/ }).click();
  const friends = lead.getByRole("dialog", { name: "Friends" });
  await expect(friends).toContainText(/guests can't add friends/i);
  await friends.getByRole("button", { name: "Start a party" }).click();

  const lp = partyPanel(lead);
  await expect(lp).toContainText(/your party · 1 of 10/i);
  // a guest leads: game and mode, but no friends to invite and no "public to friends"
  await expect(lp.getByRole("combobox", { name: "Game" })).toBeVisible();
  await expect(lp.getByRole("radiogroup", { name: "Who plays next" })).toBeVisible();
  await expect(lp.getByRole("radiogroup", { name: "Who can find the party" })).toHaveCount(0);
  await expect(lp.getByRole("list", { name: "Invite friends" })).toHaveCount(0);
  await expect(lp.getByPlaceholder(/Name#1234/)).toHaveCount(0);
  await lp.getByRole("button", { name: "Copy party link" }).click();
  await expect(lp.getByRole("status")).toContainText(/party link/i);
  const link = await lead.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/\/#\/party\/[A-Za-z0-9_-]{22}$/);
  const box = (await lp.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 0.5);
  expect(await noHorizontalScroll(lead)).toBe(true);

  // a second guest opens the link: joined on connect, the panel shows the party
  const otherCtx = await guestContext(page, browser, mobile, baseURL!);
  const other = await otherCtx.newPage();
  await other.goto(link);
  const op = partyPanel(other);
  await expect(op).toContainText(/your party · 2 of 10/i);
  await expect(lp).toContainText(/your party · 2 of 10/i);
  await expect(op.getByRole("button", { name: "Copy party link" })).toBeVisible();
  await expect(op.getByRole("button", { name: /start the match/i })).toHaveCount(0);
  await expect(other).not.toHaveURL(/#\/party\//);

  // leave, then the same link rejoins
  await op.getByRole("button", { name: "Leave party" }).click();
  await expect(lp).toContainText(/your party · 1 of 10/i);
  await other.goto("/");
  await other.goto(link);
  await expect(partyPanel(other)).toContainText(/your party · 2 of 10/i);
  await expect(lp).toContainText(/your party · 2 of 10/i);

  // the guest leader picks track and starts: both sit in a fresh room
  await lp.getByRole("combobox", { name: "Game" }).selectOption("track");
  await expect(partyPanel(other)).toContainText(/Track · Next/);
  await lp.getByRole("button", { name: "Start the match" }).click();
  for (const p of [lead, other]) {
    await expect(p).toHaveURL(/#\/room\/[A-Z]{4}$/);
    // track opens the camera setup first for a seated player (task 15)
    await useKeyboard(p);
    await expect(p.getByRole("button", { name: "I'm ready" })).toBeVisible();
    await expect(p.locator(".party-strip")).toBeVisible();
    expect(await noHorizontalScroll(p)).toBe(true);
  }
  await leadCtx.close();
  await otherCtx.close();
});

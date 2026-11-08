import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { profileButton, signInDemo } from "./flow.ts";

// Task 36: the home screen at the three sizes the user checks: full HD, a
// short laptop browser window (1366x657, where the code box once fell below
// the fold) and a phone. No horizontal scroll, the code box in view, nothing
// spilling out of a panel, the logo centred on the page; the party panel
// shows who joined; "Change my look" opens the profile; the 3D card icons
// load only where they're allowed and fall back to the flat ones.
// Each test makes its own browsers at each size, so it runs once (desktop
// project only).

const SIZES = [
  { name: "full HD", width: 1920, height: 1080, mobile: false },
  { name: "laptop window", width: 1366, height: 657, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
] as const;

test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== "desktop", "makes its own browsers at each size"));

async function at(browser: Browser, size: (typeof SIZES)[number]): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.mobile, hasTouch: size.mobile });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  return ctx.newPage();
}

type Box = { x: number; y: number; width: number; height: number };

/** Every visible element inside `panel` sits within its box (1 px slack), and the panel itself doesn't scroll. */
async function nothingSpills(page: Page, panel: string): Promise<void> {
  const out = await page.locator(panel).evaluate((root) => {
    const r = root.getBoundingClientRect();
    const bad: string[] = [];
    // drawings are checked as a whole: inside an <svg> its shapes may be cropped by its own view box
    for (const el of root.querySelectorAll<HTMLElement>(":not(svg *)")) {
      // the phone's party strip scrolls sideways on purpose
      if (el.closest(".crew") && getComputedStyle(el.closest(".crew")!).overflowX === "auto" && el !== el.closest(".crew")) continue;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      // the pointer arrow of a card that isn't pointed at is there but unseen
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      if (b.left < r.left - 1 || b.right > r.right + 1 || b.top < r.top - 1 || b.bottom > r.bottom + 1)
        bad.push(`${el.tagName.toLowerCase()}.${el.getAttribute("class") ?? ""} ${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.right)},${Math.round(b.bottom)}`);
    }
    if (root.scrollHeight > root.clientHeight + 1) bad.push(`scrolls: ${root.scrollHeight} > ${root.clientHeight}`);
    return bad;
  });
  expect(out, `${panel} spills`).toEqual([]);
}

const overlaps = (a: Box, c: Box) => a.x < c.x + c.width && c.x < a.x + a.width && a.y < c.y + c.height && c.y < a.y + a.height;

for (const size of SIZES) {
  test(`at ${size.width}x${size.height} (${size.name}): no sideways scroll, code box in view, nothing spills, logo centred`, async ({ browser }) => {
    const page = await at(browser, size);
    await page.goto("/");
    await expect(profileButton(page)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Friends/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // the code box and Join on the first screen, nothing on top of them
    for (const el of [page.getByRole("textbox", { name: /room code/i }), page.getByRole("button", { name: "Join" })]) {
      const b = (await el.boundingBox())!;
      expect(b.y + b.height, "on the first screen").toBeLessThanOrEqual(size.height);
      expect(b.x + b.width).toBeLessThanOrEqual(size.width);
      const free = await el.evaluate((e) => {
        const r = e.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!top && e.contains(top);
      });
      expect(free, "nothing covers it").toBe(true);
    }

    for (const panel of [".menu-picker", ".menu-detail", ".menu-party"]) await nothingSpills(page, panel);
    // each card's icon stays clear of its name
    for (const card of await page.locator(".sport").all()) {
      const name = (await card.locator(".sport-name").boundingBox())!;
      const icon = (await card.locator(".sport-art").boundingBox())!;
      expect(overlaps(name, icon), `${await card.getAttribute("data-sport")} icon over its name`).toBe(false);
    }

    const logo = (await page.locator(".logo-word").boundingBox())!;
    if (!size.mobile) {
      // centred on the page within a few px, and so over the middle panel
      expect(Math.abs(logo.x + logo.width / 2 - size.width / 2)).toBeLessThanOrEqual(3);
      const mid = (await page.locator(".menu-detail").boundingBox())!;
      expect(Math.abs(mid.x + mid.width / 2 - size.width / 2)).toBeLessThanOrEqual(3);
      // three columns, side by side, the same height, under the top bar
      const cols = await Promise.all([".menu-picker", ".menu-detail", ".menu-party"].map(async (s) => (await page.locator(s).boundingBox())!));
      expect(cols[0].x + cols[0].width).toBeLessThan(cols[1].x);
      expect(cols[1].x + cols[1].width).toBeLessThan(cols[2].x);
      for (const c of cols) expect(Math.abs(c.height - cols[0].height)).toBeLessThanOrEqual(2);
      expect(cols[1].y).toBeGreaterThanOrEqual(logo.y + logo.height);
      // the sports in a 2x3 grid
      const xs = new Set(await page.locator(".sport").evaluateAll((els) => els.map((e) => (e as HTMLElement).offsetLeft)));
      expect(xs.size).toBe(2);
    } else {
      // phone: sports in a 3x2 grid, then the panel, then the party strip
      const xs = new Set(await page.locator(".sport").evaluateAll((els) => els.map((e) => (e as HTMLElement).offsetLeft)));
      expect(xs.size).toBe(3);
      const detail = (await page.locator(".menu-detail").boundingBox())!;
      const party = (await page.locator(".menu-party").boundingBox())!;
      expect(party.y).toBeGreaterThanOrEqual(detail.y + detail.height);
      // Friends shows the icon and the count only
      await expect(page.locator(".fr-label")).toBeHidden();
    }
    // nothing in the top bar sits over the logo
    for (const part of [".logo-rings", ".logo-word"]) {
      const l = (await page.locator(part).boundingBox())!;
      for (const b of await page.locator(".menu-top button:visible").all()) {
        expect(overlaps((await b.boundingBox())!, l), `${await b.getAttribute("class")} over ${part}`).toBe(false);
      }
    }
    await page.context().close();
  });
}

test("the party panel shows you alone, then a friend who joins by the party link, at each size", async ({ browser }) => {
  test.setTimeout(90_000);
  const lead = await at(browser, SIZES[0]);
  await lead.goto("/");
  const panel = lead.getByRole("complementary", { name: "Your party" });
  // alone: "Ready to play!" and your own figure, in your look
  await expect(panel).toContainText("Ready to play!");
  await expect(panel.locator(".party-title")).toHaveText(/just you/i);
  await expect(panel.locator(".member")).toHaveCount(1);
  await expect(panel.locator(".member .look-svg")).toHaveCount(1);

  // start a party from the home screen's Party button, and copy its link
  await lead.getByRole("button", { name: /^party$/i }).click();
  const dialog = lead.getByRole("dialog", { name: "Party" });
  await dialog.getByRole("button", { name: "Start a party" }).click();
  await expect(dialog).toContainText(/your party · 1 of 10/i);
  await dialog.getByRole("button", { name: "Copy party link" }).click();
  await expect(dialog.getByRole("status")).toContainText(/party link/i);
  const link = await lead.evaluate(() => navigator.clipboard.readText());
  await dialog.getByRole("button", { name: "Close party" }).click();
  await expect(panel.locator(".party-title")).toHaveText(/your party · 1 of 10/i);
  await expect(panel.getByRole("button", { name: /invite a friend/i })).toBeVisible();

  // a second guest opens the link: the leader's home screen shows them at once
  const friend = await at(browser, SIZES[2]);
  await friend.goto(link);
  await expect(friend.getByRole("dialog", { name: "Party" })).toContainText(/your party · 2 of 10/i);
  await expect(panel.locator(".party-title")).toHaveText(/your party · 2 of 10/i);
  const members = panel.locator(".member");
  await expect(members).toHaveCount(2);
  // names, status dots, the leader's crown (the one who started it), the invite slot
  await expect(members.first()).toHaveAttribute("data-you", "true");
  await expect(members.first().locator(".lead")).toHaveCount(1);
  await expect(members.nth(1).locator(".lead")).toHaveCount(0);
  await expect(members.locator(".sdot")).toHaveCount(2);
  for (const m of await members.all()) expect((await m.locator(".np-name").textContent())!.length).toBeGreaterThan(2);
  await expect(panel.getByRole("button", { name: /invite a friend/i })).toBeVisible();
  // the Party button says how many
  await expect(lead.getByRole("button", { name: /your party: 2 of 10/i })).toBeVisible();
  await nothingSpills(lead, ".menu-party");

  // the friend's own home screen (a phone) shows the party as a strip, with the leader crowned
  await friend.getByRole("dialog", { name: "Party" }).getByRole("button", { name: "Close party" }).click();
  const strip = friend.getByRole("complementary", { name: "Your party" });
  await expect(strip.locator(".member")).toHaveCount(2);
  await expect(strip.locator(".lead")).toHaveCount(1);
  expect(await friend.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // the short laptop window: still fits
  await lead.setViewportSize({ width: 1366, height: 657 });
  await expect(panel.locator(".member")).toHaveCount(2);
  await nothingSpills(lead, ".menu-party");
  const code = (await lead.getByRole("textbox", { name: /room code/i }).boundingBox())!;
  expect(code.y + code.height).toBeLessThanOrEqual(657);
  await lead.context().close();
  await friend.context().close();
});

test("Change my look opens the profile at its customise section", async ({ browser }) => {
  const page = await at(browser, SIZES[0]);
  await page.goto("/");
  await expect(profileButton(page)).toBeVisible();
  // a guest is told plainly why there's no look to change
  await page.getByRole("button", { name: /^change my look$/i }).click();
  const dialog = page.getByRole("dialog", { name: "Profile" });
  await expect(dialog).toContainText(/dress your player/i);
  await page.keyboard.press("Escape");
  // an account lands on the look editor's tabs
  await signInDemo(page, "One");
  await page.getByRole("button", { name: /^change my look$/i }).click();
  await expect(dialog.getByRole("tab", { name: "Face" })).toBeFocused();
  await expect(dialog.getByRole("img", { name: "Preview of your player" })).toBeInViewport();
  await page.context().close();
});

test.describe("the 3D card icons", () => {
  test("never load in a phone-width window, nor without being asked in a test browser (the flat path has no canvas)", async ({ browser }) => {
    for (const size of [SIZES[2], SIZES[0]]) {
      const page = await at(browser, size);
      const urls: string[] = [];
      page.on("request", (r) => urls.push(r.url()));
      await page.goto(size.mobile ? "/?icons3d" : "/");
      await expect(profileButton(page)).toBeVisible();
      await page.waitForTimeout(2500);
      await expect(page.locator("canvas")).toHaveCount(0);
      await expect(page.locator(".sport svg.ic").first()).toBeVisible();
      expect(urls.filter((u) => /home-3d/.test(u))).toEqual([]);
      await page.context().close();
    }
  });

  test("load after the flat page where allowed, one per card; a slow page falls back to the flat icons", async ({ browser }) => {
    const page = await at(browser, SIZES[0]);
    await page.goto("/?icons3d=slow");
    await expect(profileButton(page)).toBeVisible();
    // the flat icons are there first
    await expect(page.locator(".sport svg.ic").first()).toBeVisible();
    await expect(page.locator(".menu")).toHaveAttribute("data-icons", "3d", { timeout: 5_000 });
    await expect(page.locator(".sport canvas.ic3d")).toHaveCount(6);
    await expect(page.locator(".sport svg.ic").first()).toBeHidden();
    // drawn: the selected card's canvas has pixels
    await expect
      .poll(() => page.locator(".sport canvas.ic3d").first().evaluate((c) => (c as HTMLCanvasElement).getContext("2d")!.getImageData(0, 0, 160, 160).data.some((v) => v > 0)))
      .toBe(true);
    // "slow": after its frame-rate check it gives way to the flat icons
    await expect(page.locator(".menu")).toHaveAttribute("data-icons", "flat", { timeout: 8_000 });
    await expect(page.locator("canvas")).toHaveCount(0);
    await expect(page.locator(".sport svg.ic").first()).toBeVisible();
    await page.context().close();
  });

  test("starting a game lets go of them", async ({ browser }) => {
    const page = await at(browser, SIZES[0]);
    await page.goto("/?icons3d");
    await expect(page.locator(".sport canvas.ic3d")).toHaveCount(6, { timeout: 5_000 });
    await page.getByRole("button", { name: /practice vs bot/i }).click();
    await expect(page.locator(".ic3d")).toHaveCount(0);
    await page.context().close();
  });
});

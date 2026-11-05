import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { openProfileDialog, openProfileMenu, profileButton, shownName, signInDemo } from "./flow.ts";

// Task 13: the Wii-style home screen. Runs at both viewports (desktop and
// mobile projects in playwright.config.ts).

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

function sentMessages(page: Page): Record<string, unknown>[] {
  const sent: Record<string, unknown>[] = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => sent.push(JSON.parse(String(f.payload)))));
  return sent;
}

test("title over the sports, the preview and the selected sport's options, all on screen", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".pm-button")).toBeVisible();
  const title = page.getByRole("heading", { level: 1, name: "Weblympics" });
  const thumb = page.getByRole("img", { name: /tennis preview/i });
  const sports = page.getByRole("group", { name: "Sports" });
  const tennis = sports.getByRole("button", { name: /tennis/i });
  const options = page.locator(".options");
  for (const el of [title, thumb, tennis, options]) await expect(el).toBeVisible();

  const [tb, pb, sb, ob] = await Promise.all([title, thumb, sports, options].map(async (el) => (await el.boundingBox())!));
  expect(tb.y + tb.height).toBeLessThanOrEqual(pb.y);
  expect(tb.y + tb.height).toBeLessThanOrEqual(sb.y);
  // the options sit under the preview, in the same column
  expect(pb.y + pb.height).toBeLessThanOrEqual(ob.y);
  if (page.viewportSize()!.width >= 900) {
    // desktop: sports on the left, preview on the right, columns of equal width
    expect(sb.x + sb.width).toBeLessThanOrEqual(pb.x);
    expect(sb.y).toBeLessThan(pb.y + pb.height);
    const picker = (await page.locator(".menu-picker").boundingBox())!;
    const detail = (await page.locator(".menu-detail").boundingBox())!;
    expect(Math.abs(picker.width - detail.width)).toBeLessThanOrEqual(2);
  } else {
    // phone: the sports stack on top of the preview
    expect(sb.y + sb.height).toBeLessThanOrEqual(pb.y);
  }

  // every sport button and every action sits inside the viewport width, and
  // Tennis's options fit the first screen
  const viewport = page.viewportSize()!;
  const reachable = [
    ...(await sports.getByRole("button").all()),
    page.getByRole("button", { name: /practice vs bot/i }),
    page.getByRole("button", { name: /create a room/i }),
    page.getByRole("button", { name: "Join" }),
  ];
  for (const el of reachable) {
    const b = (await el.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(viewport.width);
    expect(b.y + b.height).toBeLessThanOrEqual(viewport.height);
    expect(b.height).toBeGreaterThanOrEqual(44);
  }
  expect(await noHorizontalScroll(page)).toBe(true);
  // the menu never loads the 3D engine (no canvas until a game starts)
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("arrow keys move between sports and the preview follows", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".pm-button")).toBeVisible();
  const sports = page.getByRole("group", { name: "Sports" });
  const buttons = sports.getByRole("button");
  const count = await buttons.count();

  // the sport group is a single Tab stop that lands on the selected sport
  await sports.getByRole("button", { name: /tennis/i }).focus();
  await expect(page.locator(".sport:focus")).toHaveAttribute("data-sport", "tennis");
  await expect(page.locator(".sport:focus .pointer")).toBeVisible();

  await page.keyboard.press("ArrowDown");
  const second = await buttons.nth(1).getAttribute("data-sport");
  await expect(page.locator(".sport:focus")).toHaveAttribute("data-sport", second!);
  const name = (await buttons.nth(1).locator(".sport-name").textContent())!;
  await expect(page.getByRole("img", { name: new RegExp(`${name} preview`, "i") })).toBeVisible();

  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".sport:focus")).toHaveAttribute("data-sport", "tennis");
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".sport:focus")).toHaveAttribute("data-sport", (await buttons.nth(count - 1).getAttribute("data-sport"))!);
  await page.keyboard.press("Home");
  await expect(page.locator(".sport:focus")).toHaveAttribute("data-sport", "tennis");

  // Tab leaves the group for the selected sport's options
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: /create a room/i })).toBeFocused();
});

test("Enter on Tennis opens its options and practice starts exactly as before", async ({ page }) => {
  const sent = sentMessages(page);
  await page.goto("/");
  await expect(page.locator(".pm-button")).toBeVisible();
  await page.getByRole("group", { name: "Sports" }).getByRole("button", { name: /tennis/i }).focus();
  await page.keyboard.press("Enter");
  // the options open on the big button, Create a room; vs the bot is the next one
  await expect(page.getByRole("button", { name: /create a room/i })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: /practice vs bot/i })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("canvas")).toBeVisible();
  expect(sent.find((m) => m.t === "create")).toEqual({ t: "create", game: "tennis", practice: true });
});

test("coming-soon sports can't be activated and never reach the server", async ({ page }) => {
  const sent = sentMessages(page);
  await page.goto("/");
  await expect(page.locator(".pm-button")).toBeVisible();
  const placeholders = page.locator('.sport[aria-disabled="true"]');
  const n = await placeholders.count();
  for (let i = 0; i < n; i++) {
    const b = placeholders.nth(i);
    // named placeholders say so; the ?? tiles keep their secret
    if ((await b.locator(".sport-name").textContent()) === "??") await expect(b).not.toContainText(/coming soon/i);
    else await expect(b).toContainText(/coming soon/i);
    await expect(b).toHaveAttribute("tabindex", "-1");
    // screen readers and Playwright see it as disabled; force a real click anyway
    await expect(b).toBeDisabled();
    await b.click({ force: true });
    await b.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
  }
  await page.waitForTimeout(300);
  expect(sent.filter((m) => m.t === "create" || m.t === "join")).toEqual([]);
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /practice vs bot/i })).toBeVisible();
  // only playable sports are pressable; the placeholders carry no pressed state
  await expect(page.locator('.sport[aria-pressed="true"]')).toHaveAttribute("data-sport", "tennis");
});

test("the sports are Tennis, Bowling, Archery, Track and Boxing, in that order", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".pm-button")).toBeVisible();
  await expect(page.locator(".sport .sport-name")).toHaveText(["Tennis", "Bowling", "Archery", "Track", "Boxing"]);
});

test("the logo (task 14): five rings and the word in the five colours, letters bounce in once, rings float; nothing clipped", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".pm-button")).toBeVisible();
  const logo = page.getByRole("heading", { level: 1, name: "Weblympics" });
  await expect(logo).toBeVisible();
  await expect(logo.locator(".logo-ring")).toHaveCount(5);
  await expect(logo.locator(".logo-letter")).toHaveText([..."Weblympics"]);
  const colours = await logo.locator(".logo-letter").evaluateAll((els) => [...new Set(els.map((e) => getComputedStyle(e).color))]);
  expect(colours).toHaveLength(5);
  // inside the viewport, and the footer link still fits the first screen
  const viewport = page.viewportSize()!;
  const b = (await logo.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(viewport.width);
  if (viewport.width >= 900) {
    const link = (await page.getByRole("link", { name: /what makes this good/i }).boundingBox())!;
    expect(link.y + link.height).toBeLessThanOrEqual(viewport.height);
  }
  // the bounce runs once and ends; the rings loop
  const anim = await logo.evaluate((el) => ({
    letter: el.querySelector(".logo-letter")!.getAnimations().map((a) => (a.effect as KeyframeEffect).getComputedTiming().iterations),
    ring: el.querySelector(".logo-ring")!.getAnimations().map((a) => (a.effect as KeyframeEffect).getComputedTiming().iterations),
  }));
  expect(anim.letter).toEqual([1]);
  expect(anim.ring).toEqual([Infinity]);
  // the menu is drawn again when the server's welcome arrives; the bounce does
  // not start over, and within a couple of seconds every letter is at rest
  // (a finished bounce leaves no animation behind)
  await expect
    .poll(() => logo.locator(".logo-letter").evaluateAll((els) => els.every((e) => e.getAnimations().length === 0 && getComputedStyle(e).transform === "none")), { timeout: 5_000 })
    .toBe(true);
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("the logo's bounce plays once per page load: drawing the menu again does not start it over", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".pm-button")).toBeVisible();
  // let the bounce finish, then draw the menu again the way the app does (Sign in / guest)
  await expect.poll(() => page.locator(".logo-letter").evaluateAll((els) => els.every((e) => e.getAnimations().length === 0)), { timeout: 5_000 }).toBe(true);
  // draw the menu again the way the app does: signing in as a demo account (behind Dev tools) reconnects
  await signInDemo(page, "One");
  // a fresh bounce would leave letters mid-air (animating) right now
  const animating = await page.locator(".logo-letter").evaluateAll((els) => els.filter((e) => e.getAnimations().length > 0).length);
  expect(animating).toBe(0);
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("the logo and every sport's thumbnail are one still frame", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".pm-button")).toBeVisible();
    const moving = () => page.evaluate(() => [...document.querySelectorAll(".logo, .logo *, .thumb-frame *")].flatMap((el) => el.getAnimations()).length);
    expect(await moving()).toBe(0);
    // the placeholders' previews too
    for (const b of await page.locator(".sport").all()) {
      await b.focus();
      expect(await moving()).toBe(0);
    }
    // still drawn: the tennis ball is on screen mid-rally
    await page.locator(".sport").first().focus();
    await expect(page.locator(".thumb-frame .loop-ball")).toBeVisible();
  });
});

test("each sport's thumbnail is a short loop (task 23), paused while the tab is hidden", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".pm-button")).toBeVisible();
  const loops = () =>
    page.evaluate(() =>
      document
        .querySelector(".thumb-frame")!
        .getAnimations({ subtree: true })
        .map((a) => ({ iterations: (a.effect as KeyframeEffect).getComputedTiming().iterations, duration: Number((a.effect as KeyframeEffect).getComputedTiming().duration), state: a.playState })),
    );
  for (const b of await page.locator(".sport").all()) {
    await b.focus();
    const name = await b.getAttribute("data-sport");
    const list = await loops();
    expect(list.length, `${name} has a loop`).toBeGreaterThan(0);
    for (const a of list) {
      expect(a.iterations, name!).toBe(Infinity);
      // short: a few seconds a cycle
      expect(a.duration, name!).toBeLessThanOrEqual(4000);
      expect(a.state, name!).toBe("running");
    }
  }
  // the preview keeps its size while the loops run: no layout shift
  const frame = page.locator(".thumb-frame");
  const before = (await frame.boundingBox())!;
  await page.waitForTimeout(600);
  expect(await frame.boundingBox()).toEqual(before);

  // a hidden tab pauses them; visible again, they carry on
  const setHidden = (hidden: boolean) =>
    page.evaluate((h) => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
  await setHidden(true);
  expect((await loops()).every((a) => a.state === "paused")).toBe(true);
  await setHidden(false);
  expect((await loops()).every((a) => a.state === "running")).toBe(true);
  // and the home screen never makes a WebGL context (no Three.js scene)
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("the mouse cursor on the home screen is the arrow (task 23); the game keeps the normal one", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.locator(".pm-button")).toBeVisible();
  const cursorOf = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).cursor);
  if (testInfo.project.name === "mobile") {
    // touch: no custom cursor anywhere
    for (const sel of [".menu", ".menu .pill", ".sport"]) expect(await cursorOf(sel)).not.toContain("data:image/svg+xml");
    return;
  }
  for (const sel of [".menu", ".menu .pill", ".sport", ".menu a", '.sport[aria-disabled="true"]']) {
    const c = await cursorOf(sel);
    expect(c, sel).toContain("data:image/svg+xml");
    // the hotspot is the arrow's tip
    expect(c, sel).toMatch(/\)\s*6\s+3/);
  }
  expect(await cursorOf(".menu input")).toBe("text");
  // the marker on the pointed sport stays
  await page.locator(".sport").first().hover();
  await expect(page.locator(".sport.is-pointed .pointer")).toBeVisible();
  // in a game the cursor is the browser's own
  await page.getByRole("button", { name: /practice vs bot/i }).click();
  await expect(page.locator("canvas")).toBeVisible();
  expect(await cursorOf("canvas")).not.toContain("data:image/svg+xml");
});

test("every current action is still on the home screen", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".pm-button")).toBeVisible();
  for (const name of [/practice vs bot/i, /^train$/i, /create a room/i, /^join$/i, /^Profile: /]) {
    await expect(page.getByRole("button", { name })).toBeVisible();
  }
  await expect(page.getByRole("textbox", { name: /room code/i })).toBeVisible();
  // the footer keeps only the README link; sign in lives in the profile panel
  await expect(page.locator(".menu-footer").getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /what makes this good/i })).toHaveAttribute("href", "/readme/");
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("Create a room is the big primary button; vs the bot is the smaller one beside Train (user, 2026-11-05)", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".pm-button")).toBeVisible();
  const row = page.locator(".options-row");
  for (const sport of ["tennis", "archery", "track"]) {
    await page.locator(`.sport[data-sport="${sport}"]`).click();
    const vsBot = sport === "tennis" ? /practice vs bot/i : /^play vs bot$/i;
    const create = row.getByRole("button", { name: /create a room/i });
    const bot = row.getByRole("button", { name: vsBot });
    // first in the row, the yellow primary, full width and taller than the rest
    await expect(row.locator(".pill").first()).toHaveText(/create a room/i);
    await expect(create).toHaveClass(/pill--primary/);
    await expect(bot).not.toHaveClass(/pill--primary/);
    const [c, b] = [(await create.boundingBox())!, (await bot.boundingBox())!];
    expect(c.y + c.height).toBeLessThanOrEqual(b.y + 1);
    expect(c.width).toBeGreaterThan(b.width * 1.5);
    expect(c.height).toBeGreaterThan(b.height);
    // everything inside the viewport
    for (const box of [c, b]) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
  }
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("the profile button sits top right with your character's face; the name is beside it on desktop", async ({ page }) => {
  await page.goto("/");
  const button = profileButton(page);
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(button).toHaveAttribute("aria-haspopup", "dialog");
  const v = page.viewportSize()!;
  const b = (await button.boundingBox())!;
  // top right corner, inside the viewport, a comfortable tap target
  expect(b.x + b.width).toBeLessThanOrEqual(v.width);
  expect(b.x + b.width).toBeGreaterThan(v.width - 40);
  expect(b.y).toBeLessThan(30);
  expect(b.height).toBeGreaterThanOrEqual(44);
  expect(b.width).toBeGreaterThanOrEqual(44);
  // the picture is the player's own look (a guest wears seat 1's default), head and shoulders
  const avatar = button.locator(".pm-avatar .look-svg");
  await expect(avatar).toHaveAttribute("data-look", "blue/navy/s2/brown/short");
  await expect(avatar).toHaveAttribute("viewBox", "15 0 70 70");
  if (v.width >= 900) await expect(shownName(page)).toBeVisible();
  else await expect(shownName(page)).toBeHidden();
  // it doesn't sit over the title or the options
  // (the h1 box spans the row; what is drawn is the rings and the word)
  const overlaps = (a: typeof b, c: typeof b) => a.x < c.x + c.width && c.x < a.x + a.width && a.y < c.y + c.height && c.y < a.y + a.height;
  for (const part of [".logo-rings", ".logo-word"]) expect(overlaps(b, (await page.locator(part).boundingBox())!), part).toBe(false);
  expect(overlaps(b, (await page.locator(".options").boundingBox())!)).toBe(false);
  // no animation: drawn once, nothing runs on the menu for it
  expect(await button.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  expect(await noHorizontalScroll(page)).toBe(true);
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("the profile panel opens and closes by keyboard: focus in, Escape out and back to the button", async ({ page }) => {
  await page.goto("/");
  const button = profileButton(page);
  await button.focus();
  await page.keyboard.press("Enter");
  const panel = page.locator("dialog.pm-panel");
  await expect(panel).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  // labelled by the name, focus moved inside, on the first action
  const name = (await shownName(page).textContent())!;
  await expect(page.getByRole("dialog", { name })).toBeVisible();
  await expect(panel.getByRole("button", { name: /create account with a passkey/i })).toBeFocused();
  // a bigger picture of the player, the name, matches played and every account action
  await expect(panel.getByRole("img", { name: "Your player" })).toHaveAttribute("data-look", "blue/navy/s2/brown/short");
  await expect(panel.getByText(/\d+ match(es)? played/)).toBeVisible();
  for (const label of [/create account with a passkey/i, /sign in with a passkey/i, /profile details/i, /^leaderboard$/i]) {
    await expect(panel.getByRole("button", { name: label })).toBeVisible();
  }
  // Tab stays inside the modal panel
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await panel.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute("aria-expanded", "false");
  // the close button closes it too
  await page.keyboard.press("Enter");
  await page.locator("dialog.pm-panel").getByRole("button", { name: "Close" }).click();
  await expect(page.locator("dialog.pm-panel")).toHaveCount(0);
  await expect(button).toBeFocused();
});

test("the panel is a popover under the button on desktop and a bottom sheet on a phone, never scrolling sideways", async ({ page }) => {
  await page.goto("/");
  const panel = await openProfileMenu(page);
  const v = page.viewportSize()!;
  const p = (await panel.boundingBox())!;
  const b = (await profileButton(page).boundingBox())!;
  expect(p.x).toBeGreaterThanOrEqual(0);
  expect(p.x + p.width).toBeLessThanOrEqual(v.width + 0.5);
  expect(p.y + p.height).toBeLessThanOrEqual(v.height + 0.5);
  if (v.width >= 900) {
    // under the button, at its right edge, not the full width
    expect(p.y).toBeGreaterThanOrEqual(b.y + b.height);
    expect(Math.abs(p.x + p.width - (b.x + b.width))).toBeLessThanOrEqual(4);
    expect(p.width).toBeLessThan(v.width / 2);
  } else {
    // a sheet: full width, along the bottom edge
    expect(p.width).toBeGreaterThanOrEqual(v.width - 1);
    expect(Math.abs(p.y + p.height - v.height)).toBeLessThanOrEqual(1);
  }
  for (const btn of await panel.getByRole("button").all()) {
    const bb = (await btn.boundingBox())!;
    expect(bb.height).toBeGreaterThanOrEqual(44);
    expect(bb.x + bb.width).toBeLessThanOrEqual(v.width);
  }
  expect(await noHorizontalScroll(page)).toBe(true);
  // the panel's links: the leaderboard and the full profile dialog open from it
  await panel.getByRole("button", { name: "Leaderboard" }).click();
  await expect(page.getByRole("dialog", { name: "Leaderboard" })).toBeVisible();
  await page.keyboard.press("Escape");
  const dialog = await openProfileDialog(page);
  await expect(dialog.getByRole("button", { name: /create account with a passkey/i })).toBeVisible();
});

test("demo accounts sit behind a closed Dev tools in the panel; signing in changes the name and the picture (task 17)", async ({ page }) => {
  await page.goto("/");
  const avatar = profileButton(page).locator(".look-svg");
  await expect(avatar).toHaveAttribute("data-look", "blue/navy/s2/brown/short");
  const panel = await openProfileMenu(page);
  const demoOne = panel.getByRole("button", { name: /sign in as demo one/i });
  await expect(demoOne).toBeHidden();
  const devtools = panel.locator("summary", { hasText: "Dev tools" });
  await devtools.focus();
  await page.keyboard.press("Enter");
  await expect(demoOne).toBeVisible();
  await expect(panel.getByRole("button", { name: /sign in as demo two/i })).toBeVisible();
  const b = (await devtools.boundingBox())!;
  expect(b.height).toBeGreaterThanOrEqual(44);
  expect(b.x + b.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await noHorizontalScroll(page)).toBe(true);

  // give Demo One a look of its own (from the page, as the profile's Save does), then sign in from the panel
  await setDemoOneLook(page, { shirt: "green", shorts: "white", skin: "s5", hair: "blonde", style: "cap" });
  await demoOne.click();
  await expect(shownName(page)).toHaveText("Demo One");
  await expect(profileButton(page)).toHaveAccessibleName("Profile: Demo One");
  await expect(avatar).toHaveAttribute("data-look", "green/white/s5/blonde/cap");
  // focus comes back to the (redrawn) profile button
  await expect(profileButton(page)).toBeFocused();

  // the panel now offers the way back to a guest
  const again = await openProfileMenu(page);
  await expect(again.getByText("Demo account")).toBeVisible();
  await again.getByRole("button", { name: "Play as guest" }).click();
  await expect(profileButton(page)).toHaveAccessibleName(/\(guest\)$/);
  await expect(avatar).toHaveAttribute("data-look", "blue/navy/s2/brown/short");

  // put Demo One back to the default for other runs
  await setDemoOneLook(page, { shirt: "blue", shorts: "navy", skin: "s2", hair: "brown", style: "short" });
});

/** Signs this browser in as Demo One, saves a look, and signs out again; the page itself is not redrawn. */
async function setDemoOneLook(page: Page, look: Record<string, string>): Promise<void> {
  const ok = await page.evaluate(async (l) => {
    const post = (path: string, body: unknown) =>
      fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.ok);
    return (await post("/api/demo", { n: 1 })) && (await post("/api/look", { look: l })) && (await post("/api/logout", {}));
  }, look);
  expect(ok).toBe(true);
}

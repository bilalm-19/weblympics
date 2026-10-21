import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// Task 13: the Wii-style home screen. Runs at both viewports (desktop and
// mobile projects in playwright.config.ts).

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

function sentMessages(page: Page): Record<string, unknown>[] {
  const sent: Record<string, unknown>[] = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => sent.push(JSON.parse(String(f.payload)))));
  return sent;
}

test("title, then the sport preview, then the sport buttons, all on screen", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/playing as/i)).toBeVisible();
  const title = page.getByRole("heading", { level: 1, name: "Weblympics" });
  const thumb = page.getByRole("img", { name: /tennis preview/i });
  const sports = page.getByRole("group", { name: "Sports" });
  const tennis = sports.getByRole("button", { name: /tennis/i });
  for (const el of [title, thumb, tennis]) await expect(el).toBeVisible();

  const [t, p, s] = [(await title.boundingBox())!, (await thumb.boundingBox())!, (await sports.boundingBox())!];
  expect(t.y + t.height).toBeLessThanOrEqual(p.y);
  expect(p.y + p.height).toBeLessThanOrEqual(s.y);

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
  await expect(page.getByText(/playing as/i)).toBeVisible();
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
  await expect(page.getByRole("button", { name: /practice vs bot/i })).toBeFocused();
});

test("Enter on Tennis opens its options and practice starts exactly as before", async ({ page }) => {
  const sent = sentMessages(page);
  await page.goto("/");
  await expect(page.getByText(/playing as/i)).toBeVisible();
  await page.getByRole("group", { name: "Sports" }).getByRole("button", { name: /tennis/i }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /practice vs bot/i })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("canvas")).toBeVisible();
  expect(sent.find((m) => m.t === "create")).toEqual({ t: "create", game: "tennis", practice: true });
});

test("coming-soon sports can't be activated and never reach the server", async ({ page }) => {
  const sent = sentMessages(page);
  await page.goto("/");
  await expect(page.getByText(/playing as/i)).toBeVisible();
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

test("the sports are Tennis, Bowling, Archery and two ?? tiles, in that order", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/playing as/i)).toBeVisible();
  await expect(page.locator(".sport .sport-name")).toHaveText(["Tennis", "Bowling", "Archery", "??", "??"]);
});

test("the logo (task 14): five rings and the word in the five colours, letters bounce in once, rings float; nothing clipped", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/playing as/i)).toBeVisible();
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
  await expect(page.getByText(/playing as/i)).toBeVisible();
  // let the bounce finish, then draw the menu again the way the app does (Sign in / guest)
  await expect.poll(() => page.locator(".logo-letter").evaluateAll((els) => els.every((e) => e.getAnimations().length === 0)), { timeout: 5_000 }).toBe(true);
  // draw the menu again the way the app does: signing in as a demo account (behind Dev tools) reconnects
  await page.locator("summary", { hasText: "Dev tools" }).click();
  await page.getByRole("button", { name: /sign in as demo one/i }).click();
  await expect(page.locator(".who strong")).toHaveText("Demo One");
  // a fresh bounce would leave letters mid-air (animating) right now
  const animating = await page.locator(".logo-letter").evaluateAll((els) => els.filter((e) => e.getAnimations().length > 0).length);
  expect(animating).toBe(0);
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("the logo and every sport's thumbnail are one still frame", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/playing as/i)).toBeVisible();
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
  await expect(page.getByText(/playing as/i)).toBeVisible();
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
  await expect(page.getByText(/playing as/i)).toBeVisible();
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
  await expect(page.getByText(/playing as/i)).toBeVisible();
  for (const name of [/practice vs bot/i, /create a room/i, /^join$/i, /profile and sign in/i]) {
    await expect(page.getByRole("button", { name })).toBeVisible();
  }
  await expect(page.getByRole("textbox", { name: /room code/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /what makes this good/i })).toHaveAttribute("href", "/readme/");
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("demo accounts sit behind a closed Dev tools control, reachable by keyboard (task 17)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/playing as/i)).toBeVisible();
  const demoOne = page.getByRole("button", { name: /sign in as demo one/i });
  const demoTwo = page.getByRole("button", { name: /sign in as demo two/i });
  await expect(demoOne).toBeHidden();
  await expect(demoTwo).toBeHidden();

  const devtools = page.locator("summary", { hasText: "Dev tools" });
  await devtools.focus();
  await page.keyboard.press("Enter");
  await expect(demoOne).toBeVisible();
  await expect(demoTwo).toBeVisible();
  const b = (await devtools.boundingBox())!;
  expect(b.height).toBeGreaterThanOrEqual(44);
  expect(b.x + b.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await noHorizontalScroll(page)).toBe(true);

  await demoOne.click();
  await expect(page.locator(".who strong")).toHaveText("Demo One");
  await page.locator("summary", { hasText: "Dev tools" }).click();
  await page.getByRole("button", { name: /leave demo account/i }).click();
  await expect(page.locator(".who")).toContainText(/\(guest\)/);
});

import { expect, test } from "@playwright/test";
import type { Browser, Page, TestInfo } from "@playwright/test";
import { DEFAULT_LOOK, openProfileDialog, openProfileMenu, profileButton, signInDemo as signInFromPanel } from "./flow.ts";

// Tasks 18 and 33: dress your player in the profile's editor (tabs of picture
// swatches beside a big live preview), save it, and see it on the home
// avatar and on that seat in a room, for both players and a spectator. Uses
// the demo accounts (no passkey needed), each in its own browser context.

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function newPage(browser: Browser, page: Page, testInfo: TestInfo): Promise<Page> {
  const mobile = testInfo.project.name === "mobile";
  const ctx = await browser.newContext({ viewport: page.viewportSize()!, isMobile: mobile, hasTouch: mobile });
  return ctx.newPage();
}

async function signInDemo(page: Page, n: "One" | "Two"): Promise<void> {
  await page.goto("/");
  await signInFromPanel(page, n);
}

/** Saves the default look for the signed-in demo account (as the editor's Save does), so a run starts and ends clean. */
async function resetLook(page: Page): Promise<void> {
  const ok = await page.evaluate(
    (l) => fetch("/api/look", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ look: l }) }).then((r) => r.ok),
    DEFAULT_LOOK,
  );
  expect(ok).toBe(true);
}

/** The look Demo Two ends up in: a face option (eyes), clothes (a suit), eyewear (sunglasses), and a hairstyle by keyboard. */
const PICKED = { ...DEFAULT_LOOK, top: "suit", hairStyle: "buzz", skin: "s4", eyes: "wide", eyewear: "sunglasses" };
const PICKED_KEY = Object.values(PICKED).join("/");
const field = (key: string, name: keyof typeof DEFAULT_LOOK) => key.split("/")[Object.keys(DEFAULT_LOOK).indexOf(name)];

test("customise: tabs of pictures, live preview, Cancel, keyboard, saved, and seen on the avatar and on that seat by both players and a spectator", async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000);
  await signInDemo(page, "Two");
  // a run that failed half way may have left a look saved
  await resetLook(page);
  await page.reload();
  const dialog = await openProfileDialog(page);
  const preview = dialog.getByRole("img", { name: "Preview of your player" });
  await expect(preview).toBeVisible();
  const look = async () => (await preview.getAttribute("data-look"))!;
  const v = page.viewportSize()!;

  // four tabs; Face is open
  const tabs = dialog.getByRole("tab");
  await expect(tabs).toHaveText(["Face", "Hair", "Clothes", "Extras"]);
  await expect(dialog.getByRole("tab", { name: "Face" })).toHaveAttribute("aria-selected", "true");

  // every tab: its options are pictures, fit the viewport and are big enough to tap
  for (const name of ["Face", "Hair", "Clothes", "Extras"]) {
    await dialog.getByRole("tab", { name }).click();
    const panel = dialog.getByRole("tabpanel", { name });
    await expect(panel).toBeVisible();
    const options = panel.locator(".look-option");
    expect(await options.count()).toBeGreaterThan(5);
    for (const opt of await options.all()) {
      const b = (await opt.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(v.width);
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.width).toBeGreaterThanOrEqual(44);
    }
    // non-colour options are small pictures of the player
    if (name !== "Face") expect(await panel.locator(".look-thumb svg").count()).toBeGreaterThan(3);
    expect(await noHorizontalScroll(page)).toBe(true);
  }

  // a face option: wide eyes; the preview follows before saving
  await dialog.getByRole("tab", { name: "Face" }).click();
  await dialog.getByRole("radio", { name: "Wide eyes" }).check({ force: true });
  await expect.poll(async () => field(await look(), "eyes")).toBe("wide");
  await dialog.getByRole("radio", { name: "Skin tone 4" }).check({ force: true });

  // Cancel puts the saved look back, without saving
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(preview).toHaveAttribute("data-look", Object.values(DEFAULT_LOOK).join("/"));
  await expect(dialog.getByRole("radio", { name: "Round eyes" })).toBeChecked();
  await dialog.getByRole("radio", { name: "Wide eyes" }).check({ force: true });
  await dialog.getByRole("radio", { name: "Skin tone 4" }).check({ force: true });

  // keyboard: arrows move between tabs, then within a group of options
  await dialog.getByRole("tab", { name: "Face" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("tab", { name: "Hair" })).toBeFocused();
  await expect(dialog.getByRole("tabpanel", { name: "Hair" })).toBeVisible();
  await dialog.getByRole("radio", { name: "Short hair" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("radio", { name: "Buzz cut" })).toBeChecked();
  await expect.poll(async () => field(await look(), "hairStyle")).toBe("buzz");

  // a clothes option and eyewear, by mouse
  await dialog.getByRole("tab", { name: "Clothes" }).click();
  await dialog.getByRole("radio", { name: "Suit jacket" }).check({ force: true });
  await dialog.getByRole("tab", { name: "Extras" }).click();
  await dialog.getByRole("radio", { name: "Sunglasses" }).check({ force: true });
  await expect(preview).toHaveAttribute("data-look", PICKED_KEY);
  // the swatches show the look being tried on: the "No glasses" picture wears the buzz cut too
  await expect(dialog.getByRole("tabpanel", { name: "Extras" }).locator(".look-option", { hasText: "No glasses" }).locator("svg")).toHaveAttribute("data-look", PICKED_KEY.replace("/sunglasses", "/none"));

  // the preview is big, and in view, on both viewports
  const box = (await preview.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(v.width);
  expect(box.height).toBeGreaterThan(120);
  expect(await noHorizontalScroll(page)).toBe(true);

  await dialog.getByRole("button", { name: "Save look" }).click();
  await expect(dialog.getByRole("status")).toHaveText(/look saved/i);
  await dialog.getByRole("button", { name: "Close profile" }).click();
  // the profile button's picture is the new look at once, and its panel's figure too
  const avatar = profileButton(page).locator(".look-svg");
  await expect(avatar).toHaveAttribute("data-look", PICKED_KEY);
  const panel = await openProfileMenu(page);
  await expect(panel.getByRole("img", { name: "Your player" })).toHaveAttribute("data-look", PICKED_KEY);
  await page.keyboard.press("Escape");

  // a reload keeps it (it is on the account, not in this page)
  await page.reload();
  await expect(avatar).toHaveAttribute("data-look", PICKED_KEY);
  await openProfileDialog(page);
  await expect(dialog.getByRole("img", { name: "Preview of your player" })).toHaveAttribute("data-look", PICKED_KEY);
  await dialog.getByRole("button", { name: "Close profile" }).click();

  // Demo One hosts, Demo Two joins as seat 1, a guest watches
  const host = await newPage(browser, page, testInfo);
  await signInDemo(host, "One");
  await host.getByRole("button", { name: /create a room/i }).click();
  await expect(host).toHaveURL(/#\/room\/[A-Z]{4}$/);
  const link = host.url();
  // a hash change alone doesn't reload the page, so leave it first
  await page.goto("about:blank");
  await page.goto(link);
  // a cold load into a room takes 5 to 15 s here with other software-rendered browsers running (main too)
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  const watcher = await newPage(browser, page, testInfo);
  await watcher.goto(link);

  for (const p of [host, page, watcher]) {
    await expect(p.locator("canvas")).toHaveAttribute("data-look1", PICKED_KEY, { timeout: 30_000 });
    await expect(p.locator("canvas")).toHaveAttribute("data-look0", /^([a-z0-9]+\/){13}[a-z0-9]+$/);
  }

  // close the other two browsers: 3D pages left open starve the next test
  await host.context().close();
  await watcher.context().close();

  // put Demo Two back to the default so other runs start clean
  await page.goto("about:blank");
  await page.goto("/");
  await resetLook(page);
});

test("a guest sees no editor: it says saving a look needs an account, and they get the default look", async ({ page }) => {
  await page.goto("/");
  const dialog = await openProfileDialog(page);
  await expect(dialog.getByRole("button", { name: /create account with a passkey/i })).toBeVisible();
  await expect(dialog.getByText(/saving a look needs an account/i)).toBeVisible();
  await expect(dialog.getByRole("img", { name: "Preview of your player" })).toHaveCount(0);
  await expect(dialog.getByRole("tab")).toHaveCount(0);
});

import { expect, test } from "@playwright/test";
import type { Browser, Page, TestInfo } from "@playwright/test";

// Task 18: pick a look in the profile, see it live in the preview, save it,
// and the room shows it on that seat to both players and a spectator. Uses
// the demo accounts (no passkey needed), each in its own browser context.

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function newPage(browser: Browser, page: Page, testInfo: TestInfo): Promise<Page> {
  const mobile = testInfo.project.name === "mobile";
  const ctx = await browser.newContext({ viewport: page.viewportSize()!, isMobile: mobile, hasTouch: mobile });
  return ctx.newPage();
}

async function signInDemo(page: Page, n: "One" | "Two"): Promise<void> {
  await page.goto("/");
  await expect(page.getByText(/playing as/i)).toBeVisible();
  await page.locator("summary", { hasText: "Dev tools" }).click();
  await page.getByRole("button", { name: `Sign in as Demo ${n}` }).click();
  await expect(page.locator(".who strong")).toHaveText(`Demo ${n}`);
}

test("customise: live preview, keyboard, saved, and seen on that seat by both players and a spectator", async ({ page, browser }, testInfo) => {
  test.setTimeout(90_000);
  await signInDemo(page, "Two");
  await page.getByRole("button", { name: /^profile$/i }).click();
  const dialog = page.getByRole("dialog", { name: "Profile" });
  const preview = dialog.getByRole("img", { name: "Preview of your player" });
  await expect(preview).toBeVisible();

  // mouse: pick a shirt; the preview follows before saving
  await dialog.getByRole("radio", { name: "Purple shirt" }).check({ force: true });
  await expect(preview).toHaveAttribute("data-look", /^purple\//);
  // keyboard: arrows move within the hat-or-hair group
  await dialog.getByRole("radio", { name: "Short hair" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("radio", { name: "Long hair" })).toBeChecked();
  await expect(preview).toHaveAttribute("data-look", /\/long$/);
  await dialog.getByRole("radio", { name: "Skin tone 4" }).check({ force: true });

  // the preview and every option fit the viewport; nothing scrolls sideways
  const v = page.viewportSize()!;
  const box = (await preview.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(v.width);
  expect(box.height).toBeGreaterThan(60);
  for (const opt of await dialog.locator(".look-option").all()) {
    const b = (await opt.boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(v.width);
    expect(b.height).toBeGreaterThanOrEqual(44);
  }
  expect(await noHorizontalScroll(page)).toBe(true);

  await dialog.getByRole("button", { name: "Save look" }).click();
  await expect(dialog.getByRole("status")).toHaveText(/look saved/i);
  await dialog.getByRole("button", { name: "Close profile" }).click();

  // a reload keeps it (it is on the account, not in this page)
  await page.reload();
  await page.getByRole("button", { name: /^profile$/i }).click();
  await expect(dialog.getByRole("img", { name: "Preview of your player" })).toHaveAttribute("data-look", "purple/navy/s4/brown/long");
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
  await expect(page.locator("canvas")).toBeVisible();
  const watcher = await newPage(browser, page, testInfo);
  await watcher.goto(link);

  for (const p of [host, page, watcher]) {
    await expect(p.locator("canvas")).toHaveAttribute("data-look1", "purple/navy/s4/brown/long");
    await expect(p.locator("canvas")).toHaveAttribute("data-look0", /^[a-z]+\/[a-z]+\/s\d\/[a-z]+\/[a-z]+$/);
  }

  // put Demo Two back to the default so other runs start clean
  await page.goto("about:blank");
  await page.goto("/");
  await page.getByRole("button", { name: /^profile$/i }).click();
  await dialog.getByRole("radio", { name: "Blue shirt" }).check({ force: true });
  await dialog.getByRole("radio", { name: "Short hair" }).check({ force: true });
  await dialog.getByRole("radio", { name: "Skin tone 2" }).check({ force: true });
  await dialog.getByRole("button", { name: "Save look" }).click();
  await expect(dialog.getByRole("status")).toHaveText(/look saved/i);
});

test("a guest sees no customise panel: they get the default look", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /profile and sign in/i }).click();
  const dialog = page.getByRole("dialog", { name: "Profile" });
  await expect(dialog.getByRole("button", { name: /create account with a passkey/i })).toBeVisible();
  await expect(dialog.getByRole("img", { name: "Preview of your player" })).toHaveCount(0);
});

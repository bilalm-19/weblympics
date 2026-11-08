import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { openProfileDialog, openProfileMenu, profileButton, shownName } from "./flow.ts";

// Task 17: register a passkey, sign out, sign in again, rename, delete, on
// Chrome's virtual authenticator (CDP WebAuthn), at both viewports. Play never
// needs any of it.

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function virtualAuthenticator(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

/** The dialog fits the viewport, nothing scrolls sideways, every button is at least 44 px tall. */
async function dialogFits(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Profile" });
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  const v = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(v.width);
  expect(box.y + box.height).toBeLessThanOrEqual(v.height);
  for (const b of await dialog.getByRole("button").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await noHorizontalScroll(page)).toBe(true);
}

test("passkey: create an account, rename, sign out, sign in again, then delete", async ({ page }) => {
  test.setTimeout(60_000);
  await virtualAuthenticator(page);
  await page.goto("/");
  const who = profileButton(page);
  await expect(who).toHaveAccessibleName(/\(guest\)$/);
  const guestName = (await shownName(page).textContent())!;

  const dialog = await openProfileDialog(page);
  await expect(dialog.getByText(/\(guest\)/)).toBeVisible();
  await dialogFits(page);

  await dialog.getByRole("button", { name: /create account with a passkey/i }).click();
  await expect(dialog.getByRole("status")).toHaveText(/account created/i);
  // the guest's profile is kept: same name, now an account
  await expect(dialog.getByLabel("Display name")).toHaveValue(guestName);
  await expect(dialog.getByText("Passkey 1")).toBeVisible();
  await dialogFits(page);

  const name = `Ace ${Math.floor(Math.random() * 1e6)}`;
  await dialog.getByLabel("Display name").fill(name);
  await dialog.getByRole("button", { name: "Save name" }).click();
  await expect(dialog.getByRole("status")).toHaveText(/name saved/i);
  // task 34: the profile shows Name#1234
  await expect(dialog.locator(".profile-tag")).toHaveText(new RegExp(`^${name}#\\d{4}$`));
  // a name the server refuses says why
  await dialog.getByLabel("Display name").fill("Bot");
  await dialog.getByRole("button", { name: "Save name" }).click();
  await expect(dialog.getByRole("status")).toHaveText(/reserved/i);

  await dialog.getByRole("button", { name: "Close profile" }).click();
  await expect(shownName(page)).toHaveText(name);
  await expect(who).not.toHaveAccessibleName(/guest/);

  // sign out from the profile dialog
  await openProfileDialog(page);
  await dialog.getByRole("button", { name: "Sign out" }).click();
  await expect(dialog.getByRole("status")).toHaveText(/signed out/i);
  await expect(dialog.getByRole("button", { name: /sign in with a passkey/i })).toBeVisible();
  await dialog.getByRole("button", { name: "Close profile" }).click();
  await expect(who).toHaveAccessibleName(/\(guest\)$/);

  // and sign in again from the profile button's panel
  const panel = await openProfileMenu(page);
  await panel.getByRole("button", { name: /sign in with a passkey/i }).click();
  await expect(shownName(page)).toHaveText(name);
  await expect(who).not.toHaveAccessibleName(/guest/);

  // sign out from the panel too
  await (await openProfileMenu(page)).getByRole("button", { name: "Sign out" }).click();
  await expect(who).toHaveAccessibleName(/\(guest\)$/);
  await (await openProfileMenu(page)).getByRole("button", { name: /sign in with a passkey/i }).click();
  await expect(shownName(page)).toHaveText(name);

  await openProfileDialog(page);
  await dialog.getByRole("button", { name: /delete account/i }).click();
  await dialogFits(page);
  await dialog.getByRole("button", { name: /confirm with passkey and delete/i }).click();
  await expect(dialog.getByRole("status")).toHaveText(/account deleted/i);
  await dialog.getByRole("button", { name: "Close profile" }).click();
  await expect(who).toHaveAccessibleName(/\(guest\)$/);
  await expect(shownName(page)).not.toHaveText(name);
});

test("the profile dialog works by keyboard and Escape closes it", async ({ page }) => {
  await page.goto("/");
  await profileButton(page).focus();
  await page.keyboard.press("Enter");
  const panel = page.locator("dialog.pm-panel");
  await panel.getByRole("button", { name: "Profile details" }).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Profile" });
  await expect(dialog.getByRole("button", { name: /create account with a passkey/i })).toBeVisible();
  // focus is inside the dialog
  expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

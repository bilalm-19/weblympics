import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// Task 15: the webcam is the default, so every game (practice, room,
// training) opens the camera setup first. Tests that play on keys take the
// "Use keyboard instead" path, as a player without a camera would.

/** Closes the camera setup that opens when a game starts, and plays on keys and buttons. */
export async function useKeyboard(page: Page): Promise<void> {
  const panel = page.getByRole("dialog", { name: /camera setup/i });
  await panel.getByRole("button", { name: /use keyboard instead/i }).click();
  await expect(panel).toBeHidden();
}

/**
 * Skips the visibility check that ends the camera setup. The first time on a
 * device, practice then offers training (task 15); this declines it.
 */
export async function skipCheck(page: Page): Promise<void> {
  const panel = page.getByRole("dialog", { name: /camera setup/i });
  await panel.getByRole("button", { name: "Skip check" }).click();
  // the offer is drawn in the same click, so it is there now or not at all
  const skip = panel.getByRole("button", { name: "Skip training" });
  if (await skip.isVisible()) await skip.click();
  await expect(panel).toBeHidden();
}

// The home screen's profile button, top right (named "Profile: <name>"), and
// its panel: sign in and out, the demo accounts behind "Dev tools", and the
// ways to the profile dialog and the leaderboard.

export const profileButton = (page: Page) => page.getByRole("button", { name: /^Profile: / });

/** The name on the profile button (shown beside the picture on desktop, the button's label on a phone). */
export const shownName = (page: Page) => page.locator(".pm-button .pm-name");

/** Opens the profile button's panel. */
export async function openProfileMenu(page: Page) {
  await profileButton(page).click();
  const panel = page.locator("dialog.pm-panel");
  await expect(panel).toBeVisible();
  return panel;
}

/** Signs in as a demo account from the panel's closed "Dev tools". */
export async function signInDemo(page: Page, n: "One" | "Two"): Promise<void> {
  const panel = await openProfileMenu(page);
  await panel.locator("summary", { hasText: "Dev tools" }).click();
  await panel.getByRole("button", { name: `Sign in as Demo ${n}` }).click();
  await expect(shownName(page)).toHaveText(`Demo ${n}`);
}

/** Opens the full profile dialog (name, passkeys, look, delete) through the panel. */
export async function openProfileDialog(page: Page) {
  const panel = await openProfileMenu(page);
  await panel.getByRole("button", { name: /edit profile and look|profile details/i }).click();
  const dialog = page.getByRole("dialog", { name: "Profile" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Opens the leaderboard through the panel. */
export async function openLeaderboardFromMenu(page: Page) {
  const panel = await openProfileMenu(page);
  await panel.getByRole("button", { name: "Leaderboard" }).click();
  const dialog = page.getByRole("dialog", { name: "Leaderboard" });
  await expect(dialog).toBeVisible();
  return dialog;
}

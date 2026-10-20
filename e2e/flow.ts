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

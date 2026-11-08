// Every camera setting, in one place (task 25). A guest's live in this
// browser only, as before. A signed-in account's come from the server
// (`/api/me` carries them, so they follow the player to any device), are
// cached here so a game can read them at once, and every change is saved back.
// The server checks the shape (shared/camera-settings.ts) and refuses anything
// else, so what is read back is always a whole, valid set.
//
// Reads are synchronous (`cameraSettings()`): a camera panel needs its
// settings the moment it opens, not after a round trip.

import { defaultCameraSettings, parseCameraSettings } from "../../shared/camera-settings.ts";
import type { CameraSettings } from "../../shared/camera-settings.ts";

const GUEST_KEY = "camera-settings";
const ACCOUNT_KEY = "camera-settings-account";
const OWNER_KEY = "camera-settings-owner";
// from before task 25: each panel kept its own key
const LEGACY = { calibration: "camera-calibration", move: "move-mode", bow: "archery-bow-hand", run: "track-run-mode" } as const;

type Owner = "guest" | "account";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage unavailable: the settings last this visit only
  }
}

function parseStored(raw: string | null): CameraSettings | null {
  if (!raw) return null;
  try {
    return parseCameraSettings(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** A guest's settings from the keys each panel used before task 25, checked like any others. */
export function fromLegacy(get: (key: string) => string | null): CameraSettings {
  const s = defaultCameraSettings();
  try {
    const c = JSON.parse(get(LEGACY.calibration) ?? "null") as Record<string, unknown> | null;
    if (c && typeof c === "object") {
      const t = { ...s.tennis };
      if (c.hand === "left" || c.hand === "right") t.hand = c.hand;
      if (c.mode === "classic" || c.mode === "follow") t.mode = c.mode;
      if (c.aim === "timing" || c.aim === "point") t.aim = c.aim;
      if (typeof c.autoNeutral === "boolean") t.autoNeutral = c.autoNeutral;
      if (typeof c.neutralTilt === "number") t.neutralTilt = c.neutralTilt;
      if (typeof c.neutralAcross === "number") t.neutralAcross = c.neutralAcross;
      if (Array.isArray(c.thresholds)) t.forehand = t.backhand = c.thresholds as [number, number];
      // anything out of range falls back to the defaults, section by section
      s.tennis = parseCameraSettings({ tennis: t })?.tennis ?? s.tennis;
    }
  } catch {
    // corrupt: the defaults
  }
  if (get(LEGACY.move) === "tilt") s.tennis.move = "tilt";
  if (get(LEGACY.bow) === "right") s.archery.bowHand = "right";
  if (get(LEGACY.run) === "knees") s.track.mode = "knees";
  return s;
}

let owner: Owner = read(OWNER_KEY) === "account" ? "account" : "guest";
let current: CameraSettings = load(owner);
const listeners = new Set<(s: CameraSettings) => void>();
let saving: Promise<unknown> = Promise.resolve();

function load(who: Owner): CameraSettings {
  if (who === "account") return parseStored(read(ACCOUNT_KEY)) ?? defaultCameraSettings();
  return parseStored(read(GUEST_KEY)) ?? fromLegacy(read);
}

function set(next: CameraSettings): void {
  current = next;
  for (const l of listeners) l(current);
}

/** The settings in force now (a copy: change them with `updateCameraSettings`). */
export function cameraSettings(): CameraSettings {
  return structuredClone(current);
}

/** Called when the settings change: a sign-in, a sign-out, a save or a reset. */
export function onCameraSettings(fn: (s: CameraSettings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function upload(settings: CameraSettings | null): Promise<void> {
  const res = await fetch("/api/camera-settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ settings }),
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error(`camera settings not saved (${res.status})`);
}

/** Changes some settings: kept in this browser, and saved to the account when signed in. */
export function updateCameraSettings(change: (s: CameraSettings) => void): void {
  const next = cameraSettings();
  change(next);
  const checked = parseCameraSettings(next);
  // a bad value never gets stored (the server would refuse it too)
  if (!checked) return;
  set(checked);
  if (owner === "account") {
    write(ACCOUNT_KEY, JSON.stringify(checked));
    // one at a time, in order, so the last change is the one kept
    saving = saving.then(() => upload(checked)).catch(() => undefined);
  } else write(GUEST_KEY, JSON.stringify(checked));
}

/** Reset to default: every camera setting, every game. */
export function resetCameraSettings(): void {
  const fresh = defaultCameraSettings();
  set(fresh);
  if (owner === "account") {
    write(ACCOUNT_KEY, null);
    saving = saving.then(() => upload(null)).catch(() => undefined);
  } else {
    write(GUEST_KEY, JSON.stringify(fresh));
    for (const k of Object.values(LEGACY)) write(k, null);
  }
}

/**
 * Who this browser is now (from `/api/me` or a sign-in): an account's
 * settings come from the server, a guest's from this browser.
 */
export function cameraSettingsFor(me: { account: boolean; cameraSettings?: unknown } | null): void {
  const who: Owner = me?.account ? "account" : "guest";
  write(OWNER_KEY, who);
  owner = who;
  if (who === "account") {
    const s = parseCameraSettings(me?.cameraSettings ?? null);
    write(ACCOUNT_KEY, s ? JSON.stringify(s) : null);
    set(s ?? defaultCameraSettings());
  } else {
    write(ACCOUNT_KEY, null);
    set(load("guest"));
  }
}

/** A guest just became an account (a passkey claimed it): keep the settings they had. */
export async function keepGuestSettings(me: { account: boolean; cameraSettings?: unknown }): Promise<void> {
  if (!me.account || me.cameraSettings) return;
  const guest = load("guest");
  owner = "account";
  write(OWNER_KEY, "account");
  write(ACCOUNT_KEY, JSON.stringify(guest));
  set(guest);
  await upload(guest).catch(() => undefined);
}

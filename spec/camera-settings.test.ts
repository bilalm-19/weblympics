// Task 25: every camera setting saved to the account (loaded on sign-in on any
// device; guests keep theirs in the browser). One closed shape in
// shared/camera-settings.ts, checked on the server: an unknown field or an
// out-of-range value refuses the whole thing and nothing is stored.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, inject, it } from "vitest";
import { calibrationFrom } from "../client/input/camera/pose.ts";
import { fromLegacy } from "../client/net/camera-settings.ts";
import { DEFAULT_CALIBRATION, DEFAULT_SWING } from "../client/input/camera/pose.ts";
import { DEFAULT_SHOOT } from "../client/input/camera/shoot-pose.ts";
import { addPasskey, cameraSettingsOf, deleteAccount, guestFor, newGuestToken, setCameraSettings } from "../server/accounts.ts";
import { SCHEMA_VERSION, migrate, schemaVersion } from "../server/schema.ts";
import { DEFAULT_THRESHOLDS, defaultCameraSettings, parseCameraSettings } from "../shared/camera-settings.ts";
import type { CameraSettings } from "../shared/camera-settings.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function freshFile(): string {
  const d = mkdtempSync(join(tmpdir(), "weblympics-camset-"));
  dirs.push(d);
  return join(d, "app.db");
}

function account(db: DatabaseSync): string {
  const t = newGuestToken();
  guestFor(db, t);
  addPasskey(db, t, { id: `k-${Math.random()}`, publicKey: new Uint8Array([1]), counter: 0, transports: [] });
  return t;
}

/** A full, valid, non-default set. */
function custom(): CameraSettings {
  const s = defaultCameraSettings();
  s.tennis = { ...s.tennis, hand: "left", move: "tilt", forehand: [4, 8.5], backhand: [3.5, 7] };
  s.archery.bowHand = "right";
  s.track = { mode: "knees", rest: { elbows: null, knees: { left: -2.1, right: -2.05 } } };
  s.basketball.power = [2.5, 11];
  return s;
}

describe("the defaults (task 25)", () => {
  it("a fresh profile is classic swing, aim by timing, auto-move, and the swing thresholds pose.ts starts with", () => {
    const d = defaultCameraSettings();
    expect(d.tennis).toMatchObject({ mode: "classic", aim: "timing", move: "auto", hand: "right" });
    expect(d.tennis.forehand).toEqual(DEFAULT_SWING.thresholds);
    expect(d.tennis.backhand).toEqual(DEFAULT_SWING.thresholds);
    expect(DEFAULT_THRESHOLDS).toEqual(DEFAULT_SWING.thresholds);
    // and the tennis calibration made from them is pose.ts's own default
    expect(calibrationFrom(d.tennis)).toEqual(DEFAULT_CALIBRATION);
    expect(d.basketball.power).toBeNull();
    expect(parseCameraSettings(d)).toEqual(d);
  });

  it("whatever a browser saved before task 25, a fresh browser gets the defaults", () => {
    expect(fromLegacy(() => null)).toEqual(defaultCameraSettings());
  });

  it("a guest's old per-panel keys carry over, checked: an out-of-range value falls back to the defaults", () => {
    const old: Record<string, string> = {
      "camera-calibration": JSON.stringify({ hand: "left", mode: "follow", aim: "point", thresholds: [4, 8] }),
      "move-mode": "tilt",
      "archery-bow-hand": "right",
      "track-run-mode": "knees",
    };
    const s = fromLegacy((k) => old[k] ?? null);
    expect(s.tennis).toMatchObject({ hand: "left", mode: "follow", aim: "point", move: "tilt", forehand: [4, 8], backhand: [4, 8] });
    expect(s.archery.bowHand).toBe("right");
    expect(s.track.mode).toBe("knees");
    old["camera-calibration"] = JSON.stringify({ thresholds: [4, 900] });
    expect(fromLegacy((k) => old[k] ?? null).tennis.forehand).toEqual(DEFAULT_THRESHOLDS);
    old["camera-calibration"] = "{not json";
    expect(fromLegacy((k) => old[k] ?? null).tennis.forehand).toEqual(DEFAULT_THRESHOLDS);
  });
});

describe("the closed shape (task 25)", () => {
  it("takes a full, valid set as it is, and a missing section as its defaults", () => {
    expect(parseCameraSettings(custom())).toEqual(custom());
    expect(parseCameraSettings({ archery: { bowHand: "right" } })).toEqual({ ...defaultCameraSettings(), archery: { bowHand: "right" } });
    expect(parseCameraSettings({})).toEqual(defaultCameraSettings());
  });

  it("refuses an unknown field anywhere, a wrong type, a missing field inside a section, and prototype tricks", () => {
    const bad: unknown[] = [
      null,
      "x",
      [],
      { ...custom(), bowling: { speed: [1, 2] } },
      { ...custom(), tennis: { ...custom().tennis, extra: 1 } },
      { ...custom(), archery: { bowHand: "right", extra: true } },
      { ...custom(), tennis: { ...custom().tennis, hand: "both" } },
      { ...custom(), tennis: { ...custom().tennis, mode: "wild" } },
      { ...custom(), tennis: { ...custom().tennis, aim: 1 } },
      { ...custom(), tennis: { ...custom().tennis, move: "teleport" } },
      { ...custom(), tennis: { ...custom().tennis, autoNeutral: "yes" } },
      { ...custom(), tennis: { ...custom().tennis, forehand: "4,8" } },
      { ...custom(), tennis: { ...custom().tennis, forehand: [4, 8, 12] } },
      { ...custom(), track: { mode: "knees" } },
      { ...custom(), track: { mode: "knees", rest: { elbows: null } } },
      { ...custom(), track: { mode: "knees", rest: { elbows: null, knees: { left: 1 } } } },
      { ...custom(), basketball: {} },
      { ...custom(), basketball: { power: [2, "11"] } },
      JSON.parse('{"__proto__": {"tennis": 1}}'),
      { constructor: {} },
    ];
    for (const b of bad) expect(parseCameraSettings(b), JSON.stringify(b)).toBeNull();
    const { backhand: _drop, ...noBackhand } = custom().tennis;
    expect(parseCameraSettings({ tennis: noBackhand })).toBeNull();
  });

  it("refuses values out of range: NaN, infinities, huge numbers, thresholds out of order or too close", () => {
    const t = custom().tennis;
    for (const forehand of [[NaN, 8], [4, Infinity], [0, 8], [4, 1e9], [8, 4], [5, 5], [-3, 8]]) {
      expect(parseCameraSettings({ tennis: { ...t, forehand } }), JSON.stringify(forehand)).toBeNull();
    }
    expect(parseCameraSettings({ tennis: { ...t, neutralTilt: 90 } })).toBeNull();
    expect(parseCameraSettings({ tennis: { ...t, neutralAcross: -50 } })).toBeNull();
    expect(parseCameraSettings({ track: { mode: "elbows", rest: { elbows: { left: 99, right: 0 }, knees: null } } })).toBeNull();
    expect(parseCameraSettings({ basketball: { power: [5, 5.5] } })).toBeNull();
    expect(parseCameraSettings({ basketball: { power: [-1, 10] } })).toBeNull();
    expect(parseCameraSettings({ basketball: { power: [5, 400] } })).toBeNull();
    // the defaults' own power range is inside the limits
    expect(parseCameraSettings({ basketball: { power: [DEFAULT_SHOOT.power0, DEFAULT_SHOOT.power1] } })).not.toBeNull();
  });

  it("stores numbers to a thousandth", () => {
    const s = parseCameraSettings({ tennis: { ...custom().tennis, forehand: [4.123456, 8.98765] } })!;
    expect(s.tennis.forehand).toEqual([4.123, 8.988]);
  });
});

describe("saved on the account (task 25)", () => {
  it("an account saves them and reads them back; a hostile set is refused and the last good one stays", () => {
    const db = new DatabaseSync(freshFile());
    migrate(db);
    const a = account(db);
    expect(cameraSettingsOf(db, a)).toBeNull();
    expect(setCameraSettings(db, a, custom())).toEqual({ ok: true, settings: custom() });
    expect(cameraSettingsOf(db, a)).toEqual(custom());
    expect(setCameraSettings(db, a, { ...custom(), extra: "x".repeat(5000) })).toMatchObject({ ok: false, status: 400 });
    expect(setCameraSettings(db, a, { ...custom(), tennis: { ...custom().tennis, forehand: [4, 1e6] } })).toMatchObject({ ok: false, status: 400 });
    expect(cameraSettingsOf(db, a)).toEqual(custom());
  });

  it("Reset to default (null) clears them", () => {
    const db = new DatabaseSync(freshFile());
    migrate(db);
    const a = account(db);
    setCameraSettings(db, a, custom());
    expect(setCameraSettings(db, a, null)).toEqual({ ok: true, settings: null });
    expect(cameraSettingsOf(db, a)).toBeNull();
  });

  it("a guest can't save any on the server (theirs stay in the browser)", () => {
    const db = new DatabaseSync(freshFile());
    migrate(db);
    const g = newGuestToken();
    guestFor(db, g);
    expect(setCameraSettings(db, g, custom())).toMatchObject({ ok: false, status: 403 });
    expect(cameraSettingsOf(db, g)).toBeNull();
  });

  it("survive a restart and go with a deleted account", () => {
    const path = freshFile();
    let db = new DatabaseSync(path);
    migrate(db);
    const a = account(db);
    setCameraSettings(db, a, custom());
    db.close();
    db = new DatabaseSync(path);
    migrate(db);
    expect(cameraSettingsOf(db, a)).toEqual(custom());
    deleteAccount(db, a);
    expect(db.prepare("SELECT COUNT(*) AS n FROM players WHERE camera_settings IS NOT NULL").get()).toEqual({ n: 0 });
  });

  it("schema v7 opens a v6 database: every row kept, no settings yet, then takes them", () => {
    const path = freshFile();
    const db = new DatabaseSync(path);
    // v6: built through the real steps, then the v7 column taken off and the version put back
    migrate(db);
    const a = account(db);
    db.exec("ALTER TABLE players DROP COLUMN camera_settings; UPDATE schema_version SET version = 6;");
    expect(schemaVersion(db)).toBe(6);
    migrate(db);
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(7);
    expect(db.prepare("SELECT account FROM players WHERE token = ?").get(a)).toEqual({ account: 1 });
    expect(cameraSettingsOf(db, a)).toBeNull();
    expect(setCameraSettings(db, a, custom()).ok).toBe(true);
    db.close();
  });
});

// ---- the running app: a hostile client posting settings ----

const base = inject("baseUrl");

describe("a hostile client and /api/camera-settings (running app)", () => {
  it("refuses a guest, a bad shape and an extra body field; saves a good set into /api/me; null resets it", async () => {
    const origin = new URL(base).origin;
    const me = await fetch(new URL("/api/me", base));
    expect(((await me.json()) as { cameraSettings: unknown }).cameraSettings).toBeNull();
    const guest = me.headers.getSetCookie()[0].split(";")[0];
    const post = (cookie: string, body: unknown, from = origin) =>
      fetch(new URL("/api/camera-settings", base), { method: "POST", headers: { origin: from, cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await post(guest, { settings: custom() })).status).toBe(403);

    const demo = await fetch(new URL("/api/demo", base), { method: "POST", headers: { origin, "content-type": "application/json" }, body: '{"n":1}' });
    const session = demo.headers.getSetCookie()[0].split(";")[0];
    expect((await post(session, { settings: custom() }, "https://evil.example")).status).toBe(403);
    for (const bad of [{ settings: { ...custom(), tennis: { ...custom().tennis, forehand: [1, 9999] } } }, { settings: "x" }, { settings: custom(), more: 1 }, {}]) {
      expect((await post(session, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    const ok = await post(session, { settings: custom() });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { cameraSettings: unknown }).cameraSettings).toEqual(custom());
    // what another device sees on sign-in
    const again = await fetch(new URL("/api/me", base), { headers: { cookie: session } });
    expect(((await again.json()) as { cameraSettings: unknown }).cameraSettings).toEqual(custom());
    // reset: back to the defaults (null)
    const reset = await post(session, { settings: null });
    expect(((await reset.json()) as { cameraSettings: unknown }).cameraSettings).toBeNull();
  });
});

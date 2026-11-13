// The page's side of accounts (task 17): small calls to /api/*. Who you are
// lives in HttpOnly cookies the page can't read; it only ever sees what
// /api/me says. Passkey prompts are @simplewebauthn/browser's, loaded only
// when one is needed.

import type { CameraSettings } from "../../shared/camera-settings.ts";
import type { Look } from "../../shared/look.ts";
import { cameraSettingsFor, keepGuestSettings } from "./camera-settings.ts";

export interface Me {
  name: string;
  /** Task 34: an account's four-digit tag; null for a guest. */
  tag: string | null;
  account: boolean;
  demo: boolean;
  matches: number;
  passkeys: { id: string; createdAt: number; lastUsedAt: number | null }[];
  /** Saved look (task 18); null for the default. */
  look: Look | null;
  /** Task 7: rating per sport (accounts only). */
  longestRally: number;
  /** Task 25: an account's camera settings (null: the defaults); always null for a guest. */
  cameraSettings: CameraSettings | null;
  /** Task 39: the server is in LAN mode (local accounts and recovery codes, no passkeys). */
  lan: boolean;
  /** Task 39: this account has a recovery code. */
  recovery: boolean;
}

// Task 39: whether the server said it is in LAN mode. /api/me is fetched
// before the socket opens, so this is known before any menu is drawn.
let lan = false;
/** The server runs in LAN mode: offer local accounts and recovery codes, not passkeys. */
export const lanMode = (): boolean => lan;

/** Every answer that says who this is also says which camera settings apply (task 25). */
function seen(me: Me): Me {
  lan = me.lan === true;
  cameraSettingsFor(me);
  return me;
}

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : `request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

// From before accounts: the browser kept its guest id here. Handed to the
// server once (it adopts only an existing guest), then removed.
const LEGACY_TOKEN_KEY = "tennis-token";
const LEGACY_DEMO_KEY = "tennis-demo";

function takeLegacyToken(): string | null {
  try {
    const t = localStorage.getItem(LEGACY_TOKEN_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    localStorage.removeItem(LEGACY_DEMO_KEY);
    return t;
  } catch {
    return null;
  }
}

async function post<T>(path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

/** Who this browser is; a first visit is given a guest profile here. */
export async function fetchMe(): Promise<Me> {
  const legacy = takeLegacyToken();
  const res = await fetch("/api/me", { credentials: "same-origin", headers: legacy ? { "x-legacy-guest": legacy } : {} });
  if (!res.ok) throw new ApiError(res.status, {});
  return seen((await res.json()) as Me);
}

const webauthn = () => import("@simplewebauthn/browser");

export function passkeysSupported(): boolean {
  return typeof window.PublicKeyCredential === "function";
}

/** Adds a passkey: a guest becomes an account (keeping its history); an account gets another key. */
export async function addPasskey(): Promise<Me> {
  const { startRegistration } = await webauthn();
  const options = await post<Parameters<typeof startRegistration>[0]["optionsJSON"]>("/api/passkey/register/options");
  const response = await startRegistration({ optionsJSON: options });
  const me = await post<Me>("/api/passkey/register/verify", { response });
  // a guest claimed: the camera settings they had in this browser come along
  await keepGuestSettings(me);
  return me.cameraSettings ? seen(me) : me;
}

export async function signIn(): Promise<Me> {
  const { startAuthentication } = await webauthn();
  const options = await post<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("/api/passkey/login/options");
  const response = await startAuthentication({ optionsJSON: options });
  return seen(await post<Me>("/api/passkey/login/verify", { response }));
}

export const signOut = async (): Promise<unknown> => {
  const r = await post("/api/logout");
  cameraSettingsFor(null);
  return r;
};
export const signInDemo = async (n: 1 | 2): Promise<Me> => seen(await post<Me>("/api/demo", { n }));
export const setName = (name: string): Promise<Me> => post<Me>("/api/name", { name });
export const saveLook = (look: Look): Promise<Me> => post<Me>("/api/look", { look });
export const removePasskey = (id: string, confirm = false): Promise<Me> => post<Me>("/api/passkey/remove", { id, confirm });

// ---- task 34: friends. A person is only ever "Name#1234" ----
export type FriendOutcome = { ok: true; outcome: "requested" | "friends" | "already" };
export const addFriend = (who: string): Promise<FriendOutcome> => post("/api/friends/add", { who });
export const acceptFriend = (who: string): Promise<FriendOutcome> => post("/api/friends/accept", { who });
export const declineFriend = (who: string): Promise<FriendOutcome> => post("/api/friends/decline", { who });
export const removeFriend = (who: string): Promise<FriendOutcome> => post("/api/friends/remove", { who });
export const makeFriendLink = (): Promise<{ code: string; expires: number }> => post("/api/friends/link");
export const useFriendLink = (code: string): Promise<FriendOutcome> => post("/api/friends/link/use", { code });

// ---- task 39, LAN mode: local accounts and recovery codes ----

/** A guest becomes a local account. Returns the recovery code, shown once. */
export async function createLocalAccount(): Promise<{ me: Me; code: string }> {
  const r = await post<{ me: Me; code: string }>("/api/local/create");
  // the camera settings they had in this browser come along, as for a passkey
  await keepGuestSettings(r.me);
  // as addPasskey: seen() would put back the defaults keepGuestSettings just replaced
  lan = r.me.lan === true;
  return r;
}
/** Signs in on this browser with a recovery code. */
export const recoverAccount = async (code: string): Promise<Me> => seen(await post<Me>("/api/local/recover", { code }));
/** A new recovery code; the old one stops working. */
export const newRecoveryCode = (): Promise<{ me: Me; code: string }> => post("/api/local/new-code");
/** Deletes a local account, confirmed with its recovery code. */
export async function deleteLocalAccount(code: string): Promise<void> {
  await post("/api/local/delete", { code });
  cameraSettingsFor(null);
}

/** Deletes the account after a fresh passkey check. */
export async function deleteAccount(): Promise<void> {
  const { startAuthentication } = await webauthn();
  const options = await post<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("/api/account/delete/options");
  const response = await startAuthentication({ optionsJSON: options });
  await post("/api/account/delete", { response });
  cameraSettingsFor(null);
}

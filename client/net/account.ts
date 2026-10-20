// The page's side of accounts (task 17): small calls to /api/*. Who you are
// lives in HttpOnly cookies the page can't read; it only ever sees what
// /api/me says. Passkey prompts are @simplewebauthn/browser's, loaded only
// when one is needed.

import type { Look } from "../../shared/look.ts";

export interface Me {
  name: string;
  account: boolean;
  demo: boolean;
  matches: number;
  passkeys: { id: string; createdAt: number; lastUsedAt: number | null }[];
  /** Saved look (task 18); null for the default. */
  look: Look | null;
  /** Task 7: rating per sport (accounts only). */
  ratings: Record<string, { rating: number; wins: number; losses: number }>;
  longestRally: number;
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
  return (await res.json()) as Me;
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
  return post<Me>("/api/passkey/register/verify", { response });
}

export async function signIn(): Promise<Me> {
  const { startAuthentication } = await webauthn();
  const options = await post<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("/api/passkey/login/options");
  const response = await startAuthentication({ optionsJSON: options });
  return post<Me>("/api/passkey/login/verify", { response });
}

export const signOut = (): Promise<unknown> => post("/api/logout");
export const signInDemo = (n: 1 | 2): Promise<Me> => post<Me>("/api/demo", { n });
export const setName = (name: string): Promise<Me> => post<Me>("/api/name", { name });
export const saveLook = (look: Look): Promise<Me> => post<Me>("/api/look", { look });
export const removePasskey = (id: string, confirm = false): Promise<Me> => post<Me>("/api/passkey/remove", { id, confirm });

/** Deletes the account after a fresh passkey check. */
export async function deleteAccount(): Promise<void> {
  const { startAuthentication } = await webauthn();
  const options = await post<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("/api/account/delete/options");
  const response = await startAuthentication({ optionsJSON: options });
  await post("/api/account/delete", { response });
}

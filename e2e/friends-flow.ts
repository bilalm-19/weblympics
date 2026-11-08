import type { Browser, Page, TestInfo } from "@playwright/test";
import { SoftAuthenticator } from "../spec/soft-authenticator.ts";

// Task 34's e2e helpers: a fresh account made through the real passkey API
// (the spec's software authenticator), its session cookie put into a new
// browser context at the test's viewport. Several of these at once give the
// friends, invite and party flows their people without the demo accounts,
// which other tests share.

export interface Person {
  page: Page;
  name: string;
  /** "Name#1234" */
  tag: string;
  /** Posts to the API as this person (Origin set, their session cookie). */
  post(path: string, body?: unknown): Promise<Record<string, unknown>>;
}

type Opts = { challenge: string; rp: { id: string }; user: { id: string } };

/** A new account named `name` (made unique), signed in, in its own browser at the test's viewport. */
export async function person(browser: Browser, page: Page, testInfo: TestInfo, baseURL: string, name: string): Promise<Person> {
  const origin = new URL(baseURL).origin;
  const me = await fetch(new URL("/api/me", origin));
  let cookie = me.headers.getSetCookie()[0].split(";")[0];
  const post = async (path: string, body: unknown = {}) => {
    let r = await fetch(new URL(path, origin), { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
    // the server's per-address limits (40 passkey ceremonies, 60 writes a
    // minute) are real; a long run of tests from one address waits them out
    for (let i = 0; r.status === 429 && i < 15; i++) {
      await new Promise((ok) => setTimeout(ok, 5000));
      r = await fetch(new URL(path, origin), { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
    }
    const set = r.headers.getSetCookie().find((c) => c.startsWith("wl_session="));
    if (set) cookie = set.split(";")[0];
    return (await r.json()) as Record<string, unknown>;
  };
  const options = (await post("/api/passkey/register/options")) as unknown as Opts;
  await post("/api/passkey/register/verify", { response: new SoftAuthenticator(origin).register(options) });
  const unique = `${name} ${Math.floor(Math.random() * 900 + 100)}`.slice(0, 16);
  const r = await post("/api/name", { name: unique });
  const mobile = testInfo.project.name === "mobile";
  const ctx = await browser.newContext({ viewport: page.viewportSize()!, isMobile: mobile, hasTouch: mobile });
  const [k, v] = cookie.split("=");
  await ctx.addCookies([{ name: k, value: v, url: origin }]);
  const p = await ctx.newPage();
  return { page: p, name: unique, tag: `${unique}#${r.tag as string}`, post };
}

/** Makes two people friends through the API (request, accept), as their own browsers would. */
export async function befriend(a: Person, b: Person): Promise<void> {
  if ((await a.post("/api/friends/add", { who: b.tag })).ok !== true) throw new Error("add failed");
  if ((await b.post("/api/friends/accept", { who: a.tag })).ok !== true) throw new Error("accept failed");
}

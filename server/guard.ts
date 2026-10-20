// Small pieces the account API leans on, kept pure so they're tested on
// their own (spec/accounts.test.ts): cookie parsing and writing, which
// origins may run a passkey ceremony, single-use challenges and rate limits.

export function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!out.has(name)) out.set(name, value);
  }
  return out;
}

const isLocalHost = (host: string): boolean => host === "localhost" || host === "127.0.0.1" || host === "[::1]";

/** Hostname of a Host header ("localhost:8110" gives "localhost"). */
export function hostnameOf(hostHeader: string | undefined): string {
  if (!hostHeader) return "";
  if (hostHeader.startsWith("[")) return hostHeader.slice(0, hostHeader.indexOf("]") + 1);
  return hostHeader.split(":")[0].toLowerCase();
}

/**
 * A Set-Cookie value: always HttpOnly and SameSite=Lax, and Secure unless the
 * page is on localhost (where there is no https). `maxAge` 0 deletes it.
 */
export function cookie(name: string, value: string, maxAgeSeconds: number, hostHeader: string | undefined): string {
  const secure = isLocalHost(hostnameOf(hostHeader)) ? "" : "; Secure";
  return `${name}=${value}; Path=/; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}; HttpOnly; SameSite=Lax${secure}`;
}

/**
 * The page's origin if a request (or a passkey ceremony) may come from it:
 * its host must be the one the request was sent to, over https, or plain
 * http on localhost (development and tests; Fly's proxy ends TLS in front of
 * the app, so the app itself sees http while the page's origin is https). A
 * page on another site gets null: that is the CSRF check for every POST and
 * the WebSocket. A passkey is bound to that host (its rp id), so dev and the
 * Fly URL are separate registrations.
 */
export function allowedOrigin(origin: string | undefined, hostHeader: string | undefined): string | null {
  if (!origin || !hostHeader) return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.origin !== origin || url.host !== hostHeader.toLowerCase()) return null;
  if (url.protocol === "https:") return origin;
  return url.protocol === "http:" && isLocalHost(url.hostname) ? origin : null;
}

/** The rp id for an allowed origin: its hostname. */
export const rpIdFor = (origin: string): string => new URL(origin).hostname;

/** Random challenges that work once and only for a short while. */
export class Challenges<K = string> {
  private pending = new Map<string, { key: K; until: number }>();
  private ttlMs: number;
  private max: number;
  private clock: () => number;
  constructor(ttlMs: number, max = 2000, clock: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.max = max;
    this.clock = clock;
  }

  /** Remembers `challenge` for `key`; the oldest go first if too many are waiting. */
  add(challenge: string, key: K): void {
    const now = this.clock();
    for (const [c, v] of this.pending) if (v.until <= now) this.pending.delete(c);
    while (this.pending.size >= this.max) this.pending.delete(this.pending.keys().next().value!);
    this.pending.set(challenge, { key, until: now + this.ttlMs });
  }

  /** Uses up `challenge`: true only the first time, before it expires, for the same key. */
  take(challenge: string, key: K): boolean {
    const v = this.pending.get(challenge);
    if (!v) return false;
    this.pending.delete(challenge);
    return v.until > this.clock() && v.key === key;
  }
}

/** At most `limit` hits per key in any `windowMs`. */
export class RateLimit {
  private hits = new Map<string, number[]>();
  private limit: number;
  private windowMs: number;
  private clock: () => number;
  constructor(limit: number, windowMs: number, clock: () => number = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.clock = clock;
  }

  allow(key: string): boolean {
    const now = this.clock();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) {
      for (const [k, ts] of this.hits) if (ts.every((t) => now - t >= this.windowMs)) this.hits.delete(k);
    }
    return true;
  }
}

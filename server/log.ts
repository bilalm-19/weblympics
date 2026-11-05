// JSON log lines on stdout (Fly collects them: `flyctl logs`). Task 8: no
// token, cookie, credential or name ever goes in a line. A player is `who`:
// an 8-character keyed hash of their internal id, with a key made fresh each
// time the server starts, so one run's lines can be followed per player but
// never linked back to an account or across restarts.
import { createHmac, randomBytes } from "node:crypto";

const KEY = randomBytes(32);

/** A player's id in the logs: stable for this process, meaningless outside it. */
export function who(token: string): string {
  return createHmac("sha256", KEY).update(token).digest("hex").slice(0, 8);
}

// Backstop: fields that must never be written, whatever a caller passes.
const FORBIDDEN = new Set(["token", "cookie", "session", "name", "from", "to", "credential", "challenge", "password", "email"]);

export function log(event: string, fields: Record<string, unknown> = {}): void {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) if (!FORBIDDEN.has(k.toLowerCase())) safe[k] = v;
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...safe }));
}

// The dev client on :5173 proxies /api, /ws and /readme to the server on :8080.
// If the proxy rewrites Host (changeOrigin), the server's Origin check
// (server/guard.ts: Origin's host must equal Host) refuses every passkey and
// account POST with "Wrong origin." (seen 2026-11-05 signing in on :5173).
import { describe, expect, it } from "vitest";
import config from "../vite.config.ts";

describe("dev proxy keeps the browser's Host", () => {
  it("no proxied path rewrites Host", () => {
    const proxy = (config as { server?: { proxy?: Record<string, unknown> } }).server?.proxy ?? {};
    expect(Object.keys(proxy).sort()).toEqual(["/api", "/readme", "/ws"]);
    for (const [path, rule] of Object.entries(proxy)) {
      expect(typeof rule, path).toBe("object");
      expect((rule as { changeOrigin?: boolean }).changeOrigin, path).toBe(false);
    }
  });
});

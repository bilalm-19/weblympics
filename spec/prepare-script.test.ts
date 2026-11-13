// package.json "prepare" runs on every `pnpm install`, and `pnpm lan` checks
// the install first. On Windows pnpm runs scripts under cmd, where the old sh
// line (`>/dev/null 2>&1 && ... || true`) failed and stopped both (2026-11-13).
// It also runs in the Docker build stage before the repo is copied in, so it
// can't need a file from the repo, and outside a git checkout it must succeed.
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const prepare = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> }).scripts.prepare;
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "wl-prepare-"));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('package.json "prepare"', () => {
  it("uses no sh-only syntax that cmd can't run", () => {
    expect(prepare).not.toMatch(/\/dev\/null|\|\| *true|2>&1/);
  });

  it("sets core.hooksPath in a git checkout, with no repo files present", () => {
    const d = tmp();
    execFileSync("git", ["init", "-q"], { cwd: d });
    execSync(prepare, { cwd: d, stdio: "ignore" }); // cmd on Windows, sh elsewhere, as pnpm runs it
    expect(execFileSync("git", ["config", "core.hooksPath"], { cwd: d, encoding: "utf8" }).trim()).toBe(".githooks");
  });

  it("succeeds outside a git checkout (the Docker build)", () => {
    expect(() => execSync(prepare, { cwd: tmp(), stdio: "ignore", env: { ...process.env, GIT_CEILING_DIRECTORIES: tmpdir() } })).not.toThrow();
  });
});

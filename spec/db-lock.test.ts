// Several processes open the same database (the server and test workers):
// a write must wait for another process's lock, not fail at once with
// "database is locked" (seen 2026-11-05 as a flaky `pnpm check`).
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../server/db.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Another process takes the write lock, says "locked", holds it `ms`, then commits. */
function holdLock(file: string, ms: number): Promise<void> {
  const code = `
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(${JSON.stringify(file)});
    db.exec("PRAGMA journal_mode = WAL; BEGIN IMMEDIATE; INSERT INTO t VALUES (1);");
    process.stdout.write("locked\\n");
    setTimeout(() => { db.exec("COMMIT"); db.close(); }, ${ms});`;
  const child = spawn(process.execPath, ["-e", code], { stdio: ["ignore", "pipe", "inherit"] });
  return new Promise((resolve, reject) => {
    child.stdout.on("data", (b: Buffer) => b.toString().includes("locked") && resolve());
    child.on("error", reject);
  });
}

describe("database lock", () => {
  it("a write waits for another process's lock instead of failing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lock-"));
    dirs.push(dir);
    const file = join(dir, "app.db");
    const db = openDatabase(file);
    db.exec("CREATE TABLE t (x INTEGER)");
    await holdLock(file, 400);
    expect(() => db.exec("INSERT INTO t VALUES (2)")).not.toThrow();
    expect(db.prepare("SELECT count(*) AS n FROM t").get()).toEqual({ n: 2 });
    db.close();
  });
});

describe("each spec worker has its own database", () => {
  it("DATA_DIR is a fresh per-worker directory, not the shared ./data", () => {
    // spec/worker-data.ts runs before every test file in this worker
    expect(process.env.DATA_DIR).toBeDefined();
    expect(process.env.DATA_DIR).toContain("spec-worker-");
  });
});

// Each vitest worker that imports server code (server/db.ts opens the database
// at import) gets its own data directory. Without this, several workers open
// the same ./data/app.db at once and one fails with "database is locked":
// switching it to WAL needs an exclusive lock that SQLite's busy wait does not
// cover. The running app the spec checks over HTTP keeps its own DATA_DIR.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "spec-worker-"));

// Throwaway databases and folders for the spec, cleaned up so it also passes on
// Windows (2026-11-13). Linux deletes a file that is still open; Windows
// refuses (EPERM), so a test that left its database open, or a child server
// that hadn't exited yet, failed in its afterEach there although its checks
// passed. openDb remembers every database it opens; cleanTemp closes them all,
// then removes the folders, retrying briefly while Windows lets go of them.
import { rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const opened: DatabaseSync[] = [];

/** `new DatabaseSync(path)`, closed by the next cleanTemp(). */
export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  opened.push(db);
  return db;
}

/** Close every database openDb opened, then remove the given folders (emptying the list). */
export function cleanTemp(dirs: string[]): void {
  for (const db of opened.splice(0)) if (db.isOpen) db.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

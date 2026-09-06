import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DB_PATH = process.env.CC_DB_PATH ?? join(process.cwd(), "close-controller.db");

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  _db.exec(readFileSync(join(process.cwd(), "src/lib/schema.sql"), "utf8"));
  return _db;
}

/** Drops every table and re-applies schema.sql. Used by `npm run db:reset`. */
export function resetDb(): void {
  const d = db();
  const tables = d
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  d.pragma("foreign_keys = OFF");
  for (const { name } of tables) d.exec(`DROP TABLE IF EXISTS "${name}"`);
  d.pragma("foreign_keys = ON");
  d.exec(readFileSync(join(process.cwd(), "src/lib/schema.sql"), "utf8"));
}

export const nowIso = () => new Date().toISOString();

/** Short, readable, sortable-ish ids. Prefixed so they are self-describing in the audit log. */
export function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

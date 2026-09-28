import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config } from '../config.js';

let db = null;

export function getDb() {
  if (db) return db;

  db = new Database(config.databaseFile);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Applies every *.sql file in src/migrations that has not run yet. */
export function runMigrations({ silent = false } = {}) {
  const database = getDb();
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name       TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const applied = new Set(
    database.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name),
  );

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const ran = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const apply = database.transaction(() => {
      database.exec(sql);
      database
        .prepare('INSERT INTO schema_migrations (name) VALUES (?)')
        .run(file);
    });
    apply();
    ran.push(file);
    if (!silent) console.log(`[migrate] applied ${file}`);
  }

  if (!silent && ran.length === 0) console.log('[migrate] database already up to date');
  return ran;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

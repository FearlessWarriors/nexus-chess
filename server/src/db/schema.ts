/**
 * db/schema.ts — SQLite Schema Initialization
 *
 * Creates and migrates the database to the latest schema.
 * Run once at server startup.
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', '..', 'data', 'nexus.db');

export function getDbPath(): string {
  return DB_PATH;
}

function getTableColumns(db: Database.Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function ensureColumn(db: Database.Database, table: string, columnDef: string): void {
  const name = columnDef.trim().split(/\s+/)[0];
  const columns = getTableColumns(db, table);
  if (columns.has(name)) {
    return;
  }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
}

/**
 * Initialize the database: create tables and run migrations.
 * Safe to call every server start — uses IF NOT EXISTS.
 */
export function initDatabase(db: Database.Database): void {
  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      elo INTEGER NOT NULL DEFAULT 1200,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      draws INTEGER NOT NULL DEFAULT 0,
      role TEXT NOT NULL DEFAULT 'user',
      banned_until TEXT,
      ban_reason TEXT,
      banned_by INTEGER REFERENCES users(id),
      banned_at TEXT,
      ban_updated_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      white_id INTEGER REFERENCES users(id),
      black_id INTEGER REFERENCES users(id),
      result TEXT NOT NULL DEFAULT 'in_progress',
      winner_id INTEGER REFERENCES users(id),
      fen_history TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS admin_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      target_user_id INTEGER REFERENCES users(id),
      reason TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Legacy migrations (existing columns) — MUST run before index creation
  ensureColumn(db, 'users', "role TEXT NOT NULL DEFAULT 'user'");
  ensureColumn(db, 'users', 'banned_until TEXT');
  ensureColumn(db, 'users', 'ban_reason TEXT');
  ensureColumn(db, 'users', 'banned_by INTEGER REFERENCES users(id)');
  ensureColumn(db, 'users', 'banned_at TEXT');
  ensureColumn(db, 'users', 'ban_updated_at TEXT');

  // Admin & Badge system migrations (v2)
  ensureColumn(db, 'users', 'is_admin INTEGER DEFAULT 0');
  ensureColumn(db, 'users', 'badge_text TEXT DEFAULT \'\'');
  ensureColumn(db, 'users', 'badge_type TEXT DEFAULT \'\'');
  ensureColumn(db, 'users', 'suspended INTEGER DEFAULT 0');
  ensureColumn(db, 'users', 'suspended_reason TEXT DEFAULT \'\'');

  // Indexes — safe after all columns exist
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_name ON users(name);
    CREATE INDEX IF NOT EXISTS idx_users_elo ON users(elo DESC);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_users_banned_until ON users(banned_until);
    CREATE INDEX IF NOT EXISTS idx_games_players ON games(white_id, black_id);
    CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit(created_at DESC);
  `);
}

/**
 * Open and initialize the database, returning the Database handle.
 */
export function openDatabase(): Database.Database {
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const db = new Database(DB_PATH);
  initDatabase(db);
  return db;
}

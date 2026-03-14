import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";

export function createTestDb() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });

  // Create tables
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      oidc_sub TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      openai_project_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      provider TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      provider_key_id TEXT,
      key_hint TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE anthropic_key_pool (
      id TEXT PRIMARY KEY,
      workspace_id TEXT,
      anthropic_key_id TEXT UNIQUE NOT NULL,
      key_hint TEXT,
      key_hash TEXT,
      key_value TEXT,
      assigned_to TEXT REFERENCES users(id),
      assigned_at TEXT,
      status TEXT NOT NULL DEFAULT 'available'
    );

    CREATE TABLE cost_snapshots (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      date TEXT NOT NULL,
      user_id TEXT REFERENCES users(id),
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cost_usd REAL NOT NULL,
      raw_data TEXT
    );

    CREATE TABLE budgets (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      scope_id TEXT,
      monthly_limit_usd REAL NOT NULL,
      alert_threshold_pct INTEGER NOT NULL DEFAULT 80
    );
  `);

  return { db, sqlite };
}

export function seedUser(
  db: ReturnType<typeof createTestDb>["db"],
  overrides: Partial<schema.User> & { id: string; oidcSub: string; email: string }
) {
  return db
    .insert(schema.users)
    .values({ role: "user", ...overrides })
    .returning()
    .get();
}

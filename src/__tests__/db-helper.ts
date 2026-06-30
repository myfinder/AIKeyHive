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
      expires_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT,
      revocation_error TEXT
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

    CREATE TABLE proxy_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      key_hash TEXT UNIQUE NOT NULL,
      key_hint TEXT NOT NULL,
      upstream_project_id TEXT,
      upstream_provider_key_id TEXT,
      upstream_key_value TEXT,
      upstream_key_hint TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT,
      last_used_at TEXT
    );

    CREATE TABLE proxy_key_policies (
      id TEXT PRIMARY KEY,
      proxy_key_id TEXT NOT NULL REFERENCES proxy_keys(id),
      provider TEXT NOT NULL,
      allowed_models_json TEXT NOT NULL,
      hourly_limit_usd REAL NOT NULL,
      daily_limit_usd REAL NOT NULL,
      monthly_limit_usd REAL NOT NULL,
      max_request_usd REAL NOT NULL,
      max_output_tokens INTEGER NOT NULL,
      max_concurrency INTEGER NOT NULL DEFAULT 1,
      allow_tools INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE model_prices (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_usd_per_1m REAL NOT NULL,
      cached_input_usd_per_1m REAL,
      output_usd_per_1m REAL NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX model_prices_active_provider_model_unique
      ON model_prices (provider, model)
      WHERE active = 1;

    CREATE TABLE proxy_usage_events (
      id TEXT PRIMARY KEY,
      proxy_key_id TEXT NOT NULL REFERENCES proxy_keys(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      provider TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      request_id TEXT,
      provider_request_id TEXT,
      estimated_cost_usd REAL NOT NULL,
      reserved_cost_usd REAL NOT NULL,
      actual_cost_usd REAL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      raw_usage_json TEXT,
      error_code TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE proxy_budget_reservations (
      id TEXT PRIMARY KEY,
      proxy_key_id TEXT NOT NULL REFERENCES proxy_keys(id),
      hour_window TEXT NOT NULL,
      day_window TEXT NOT NULL,
      month_window TEXT NOT NULL,
      reserved_micro_usd INTEGER NOT NULL,
      actual_micro_usd INTEGER,
      released INTEGER NOT NULL DEFAULT 0,
      reconciled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
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

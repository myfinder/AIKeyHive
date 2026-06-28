#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";

const MIGRATIONS_TABLE = "__drizzle_migrations";
const APPLICATION_TABLES = [
  "anthropic_key_pool",
  "api_keys",
  "budgets",
  "cost_snapshots",
  "users",
];

loadEnvFile(".env");
loadEnvFile(".env.local");

const databaseUrl =
  process.env.TURSO_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "file:local.db";
if (databaseUrl.startsWith("file:")) {
  delete process.env.TURSO_AUTH_TOKEN;
  delete process.env.DATABASE_AUTH_TOKEN;
}
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN;

const client = createClient({
  url: databaseUrl,
  ...(authToken ? { authToken } : {}),
});

const tables = await listTables();
if (!tables.has(MIGRATIONS_TABLE) && hasExistingApplicationSchema(tables)) {
  console.log(
    "Existing database without Drizzle migration history detected; baselining migrations."
  );
  runDrizzleKit("push");
  await baselineExistingMigrations();
}

runDrizzleKit("migrate");

async function listTables() {
  const result = await client.execute(
    "select name from sqlite_master where type = 'table'"
  );
  return new Set(result.rows.map((row) => String(row.name)));
}

function hasExistingApplicationSchema(tables) {
  return APPLICATION_TABLES.some((table) => tables.has(table));
}

async function baselineExistingMigrations() {
  await client.execute(`CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at numeric
  )`);

  const journal = JSON.parse(
    readFileSync(join("drizzle", "meta", "_journal.json"), "utf8")
  );
  const migrationFiles = new Set(
    readdirSync("drizzle").filter((file) => file.endsWith(".sql"))
  );

  for (const entry of journal.entries) {
    const fileName = `${entry.tag}.sql`;
    if (!migrationFiles.has(fileName)) {
      throw new Error(`Missing migration file: drizzle/${fileName}`);
    }

    const sql = readFileSync(join("drizzle", fileName), "utf8");
    await client.execute({
      sql: `INSERT INTO "${MIGRATIONS_TABLE}" ("hash", "created_at") VALUES (?, ?)`,
      args: [createHash("sha256").update(sql).digest("hex"), entry.when],
    });
  }
}

function runDrizzleKit(command) {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(npx, ["drizzle-kit", command], {
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function loadEnvFile(path) {
  if (!existsSync(path)) {
    return;
  }

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) {
      continue;
    }

    process.env[match[1]] = parseEnvValue(match[2]);
  }
}

function parseEnvValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

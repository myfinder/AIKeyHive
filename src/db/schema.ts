import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  oidcSub: text("oidc_sub").unique().notNull(),
  email: text("email").unique().notNull(),
  name: text("name"),
  role: text("role", { enum: ["user", "admin"] })
    .notNull()
    .default("user"),
  openaiProjectId: text("openai_project_id"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const apiKeys = sqliteTable("api_keys", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  provider: text("provider", {
    enum: ["openai", "anthropic", "gemini"],
  }).notNull(),
  name: text("name").notNull().default(""),
  providerKeyId: text("provider_key_id"),
  keyHint: text("key_hint"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const anthropicKeyPool = sqliteTable("anthropic_key_pool", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  workspaceId: text("workspace_id"),
  anthropicKeyId: text("anthropic_key_id").unique().notNull(),
  keyHint: text("key_hint"),
  keyHash: text("key_hash"),
  keyValue: text("key_value"),
  assignedTo: text("assigned_to").references(() => users.id),
  assignedAt: text("assigned_at"),
  status: text("status", {
    enum: ["available", "assigned", "disabled"],
  })
    .notNull()
    .default("available"),
});

export const costSnapshots = sqliteTable("cost_snapshots", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  provider: text("provider", {
    enum: ["openai", "anthropic", "gemini"],
  }).notNull(),
  date: text("date").notNull(),
  userId: text("user_id").references(() => users.id),
  model: text("model"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  costUsd: real("cost_usd").notNull(),
  rawData: text("raw_data"),
});

export const budgets = sqliteTable("budgets", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  scope: text("scope", { enum: ["user", "team", "global"] }).notNull(),
  scopeId: text("scope_id"),
  monthlyLimitUsd: real("monthly_limit_usd").notNull(),
  alertThresholdPct: integer("alert_threshold_pct").notNull().default(80),
});

export type User = typeof users.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type AnthropicPoolKey = typeof anthropicKeyPool.$inferSelect;
export type CostSnapshot = typeof costSnapshots.$inferSelect;
export type Budget = typeof budgets.$inferSelect;

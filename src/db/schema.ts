import {
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
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

export const proxyKeys = sqliteTable("proxy_keys", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  keyHash: text("key_hash").unique().notNull(),
  keyHint: text("key_hint").notNull(),
  upstreamProjectId: text("upstream_project_id"),
  upstreamProviderKeyId: text("upstream_provider_key_id"),
  upstreamKeyValue: text("upstream_key_value"),
  upstreamKeyHint: text("upstream_key_hint"),
  status: text("status", { enum: ["active", "revoked"] })
    .notNull()
    .default("active"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  revokedAt: text("revoked_at"),
  lastUsedAt: text("last_used_at"),
});

export const proxyKeyPolicies = sqliteTable("proxy_key_policies", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  proxyKeyId: text("proxy_key_id")
    .notNull()
    .references(() => proxyKeys.id),
  provider: text("provider", {
    enum: ["openai", "anthropic", "gemini"],
  }).notNull(),
  allowedModelsJson: text("allowed_models_json").notNull(),
  hourlyLimitUsd: real("hourly_limit_usd").notNull(),
  dailyLimitUsd: real("daily_limit_usd").notNull(),
  monthlyLimitUsd: real("monthly_limit_usd").notNull(),
  maxRequestUsd: real("max_request_usd").notNull(),
  maxOutputTokens: integer("max_output_tokens").notNull(),
  maxConcurrency: integer("max_concurrency").notNull().default(1),
  allowTools: integer("allow_tools").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const modelPrices = sqliteTable(
  "model_prices",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    provider: text("provider", {
      enum: ["openai", "anthropic", "gemini"],
    }).notNull(),
    model: text("model").notNull(),
    inputUsdPer1m: real("input_usd_per_1m").notNull(),
    cachedInputUsdPer1m: real("cached_input_usd_per_1m"),
    outputUsdPer1m: real("output_usd_per_1m").notNull(),
    active: integer("active").notNull().default(1),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    uniqueIndex("model_prices_active_provider_model_unique")
      .on(table.provider, table.model)
      .where(sql`${table.active} = 1`),
  ]
);

export const proxyUsageEvents = sqliteTable("proxy_usage_events", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  proxyKeyId: text("proxy_key_id")
    .notNull()
    .references(() => proxyKeys.id),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  provider: text("provider", {
    enum: ["openai", "anthropic", "gemini"],
  }).notNull(),
  endpoint: text("endpoint", {
    enum: ["responses", "chat_completions"],
  }).notNull(),
  model: text("model").notNull(),
  status: text("status", {
    enum: ["reserved", "succeeded", "failed", "usage_unknown"],
  }).notNull(),
  requestId: text("request_id"),
  providerRequestId: text("provider_request_id"),
  estimatedCostUsd: real("estimated_cost_usd").notNull(),
  reservedCostUsd: real("reserved_cost_usd").notNull(),
  actualCostUsd: real("actual_cost_usd"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  rawUsageJson: text("raw_usage_json"),
  errorCode: text("error_code"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  completedAt: text("completed_at"),
});

export const proxyBudgetReservations = sqliteTable("proxy_budget_reservations", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  proxyKeyId: text("proxy_key_id")
    .notNull()
    .references(() => proxyKeys.id),
  hourWindow: text("hour_window").notNull(),
  dayWindow: text("day_window").notNull(),
  monthWindow: text("month_window").notNull(),
  reservedMicroUsd: integer("reserved_micro_usd").notNull(),
  actualMicroUsd: integer("actual_micro_usd"),
  released: integer("released").notNull().default(0),
  reconciled: integer("reconciled").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  completedAt: text("completed_at"),
});

export type User = typeof users.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type AnthropicPoolKey = typeof anthropicKeyPool.$inferSelect;
export type CostSnapshot = typeof costSnapshots.$inferSelect;
export type Budget = typeof budgets.$inferSelect;
export type ProxyKey = typeof proxyKeys.$inferSelect;
export type ProxyKeyPolicy = typeof proxyKeyPolicies.$inferSelect;
export type ModelPrice = typeof modelPrices.$inferSelect;
export type ProxyUsageEvent = typeof proxyUsageEvents.$inferSelect;
export type ProxyBudgetReservation =
  typeof proxyBudgetReservations.$inferSelect;

# Cost Guard Proxy Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Proxy Mode to AIKeyHive that issues virtual API keys and hard-stops expensive OpenAI requests before forwarding them, while keeping existing provider-key issuance as lightweight Direct Mode.

**Architecture:** Existing `/api/keys` remains Direct Mode and continues to manage real provider keys. New Proxy Mode adds virtual keys, policy tables, a usage ledger, Redis-backed atomic budget reservations, and OpenAI-compatible proxy routes for Responses and Chat Completions. The Vercel Next.js app can host the MVP data plane, but the proxy code must stay isolated so it can later move to a separate service without rewriting the control plane.

**Tech Stack:** Next.js App Router route handlers, TypeScript, Drizzle ORM with SQLite/Turso, Vitest, Web Streams API, Vercel Functions, Upstash Redis REST client.

---

## Scope

### MVP In Scope

- Keep existing real provider key issuance as Direct Mode.
- Add Proxy Mode virtual key issuance for OpenAI only.
- Support OpenAI-compatible:
  - `POST /api/proxy/openai/v1/responses`
  - `POST /api/proxy/openai/v1/chat/completions`
- Support streaming and non-streaming pass-through.
- Enforce these checks before upstream calls:
  - active virtual key
  - model allowlist
  - known model pricing
  - required output token cap
  - per-request maximum estimated cost
  - hourly, daily, and monthly budget reservations
  - max concurrent requests per proxy key
- Record usage events for completed requests.
- Fail closed when Redis or price catalog is unavailable.

### Out Of Scope

- Hard budget enforcement for Direct Mode.
- Anthropic and Gemini proxy adapters.
- Hosted tools, background mode, file/image inputs, Batch API, Realtime API, fine-tuning, and embeddings.
- Enterprise approval workflow.
- Moving proxy execution off Vercel.

---

## File Structure

### Database And Domain

- Modify `src/db/schema.ts`
  - Add `proxyKeys`, `proxyKeyPolicies`, `proxyUsageEvents`, and `modelPrices`.
- Modify `src/__tests__/db-helper.ts`
  - Add matching test tables.
- Create `src/lib/proxy/key.ts`
  - Generate and hash virtual keys.
- Create `src/lib/proxy/types.ts`
  - Shared provider, endpoint, policy, and usage types.
- Create `src/lib/proxy/pricing.ts`
  - Price lookup and cost calculation.
- Create `src/lib/proxy/openai-policy.ts`
  - Validate OpenAI request bodies and estimate max cost.
- Create `src/lib/proxy/redis.ts`
  - Redis client creation and configuration checks.
- Create `src/lib/proxy/reservation.ts`
  - Atomic budget/concurrency reservation, refund, and release.
- Create `src/lib/proxy/usage.ts`
  - Persist usage events.
- Create `src/lib/proxy/sse.ts`
  - Parse SSE frames while passing bytes through.

### API Routes

- Keep `src/app/api/keys/route.ts` as Direct Mode.
- Keep `src/app/api/keys/[id]/route.ts` as Direct Mode deletion.
- Create `src/app/api/proxy-keys/route.ts`
  - User-facing Proxy Mode key list/create.
- Create `src/app/api/proxy-keys/[id]/route.ts`
  - Revoke/delete Proxy Mode keys.
- Create `src/app/api/proxy/openai/v1/responses/route.ts`
  - OpenAI Responses proxy route.
- Create `src/app/api/proxy/openai/v1/chat/completions/route.ts`
  - OpenAI Chat Completions proxy route.
- Modify `src/middleware.ts`
  - Let `/api/proxy/` bypass NextAuth and use proxy-key bearer auth in the route itself.

### UI

- Rename user-facing existing API key copy to Direct Keys where practical.
- Create `src/components/proxy-key-create-dialog.tsx`.
- Create `src/components/proxy-key-table.tsx`.
- Add `useProxyKeys()` to `src/hooks/use-keys.ts`.
- Modify `src/app/dashboard/page.tsx`
  - Show Direct Keys and Proxy Keys as separate sections or tabs.

### Configuration

- Modify `package.json`
  - Add `@upstash/redis`.
- Modify `.env.example`
  - Add `OPENAI_PROXY_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
- Modify `vercel.json` only if route-level `maxDuration` is not enough.

---

## Task 1: Add Proxy Mode Schema

**Files:**

- Modify `src/db/schema.ts`
- Modify `src/__tests__/db-helper.ts`
- Test by running existing suite

- [ ] **Step 1: Add failing schema-level test coverage**

Create `src/lib/proxy/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTestDb, seedUser } from "@/__tests__/db-helper";
import { modelPrices, proxyKeyPolicies, proxyKeys, proxyUsageEvents } from "@/db/schema";

describe("proxy schema", () => {
  it("stores proxy keys, policies, model prices, and usage events", () => {
    const testDb = createTestDb();
    seedUser(testDb.db, {
      id: "u1",
      oidcSub: "sub1",
      email: "u1@example.com",
    });

    testDb.db.insert(proxyKeys).values({
      id: "pk1",
      userId: "u1",
      name: "dev-proxy",
      keyHash: "hash1",
      keyHint: "akp_...1234",
      status: "active",
    }).run();

    testDb.db.insert(proxyKeyPolicies).values({
      id: "pol1",
      proxyKeyId: "pk1",
      provider: "openai",
      allowedModelsJson: JSON.stringify(["gpt-5-mini"]),
      hourlyLimitUsd: 5,
      dailyLimitUsd: 20,
      monthlyLimitUsd: 100,
      maxRequestUsd: 1,
      maxOutputTokens: 4096,
      maxConcurrency: 2,
      allowTools: 0,
    }).run();

    testDb.db.insert(modelPrices).values({
      id: "price1",
      provider: "openai",
      model: "gpt-5-mini",
      inputUsdPer1m: 0.25,
      cachedInputUsdPer1m: 0.025,
      outputUsdPer1m: 2,
      active: 1,
    }).run();

    testDb.db.insert(proxyUsageEvents).values({
      id: "evt1",
      proxyKeyId: "pk1",
      userId: "u1",
      provider: "openai",
      endpoint: "responses",
      model: "gpt-5-mini",
      status: "succeeded",
      estimatedCostUsd: 0.01,
      reservedCostUsd: 0.02,
      actualCostUsd: 0.01,
      inputTokens: 10,
      outputTokens: 20,
    }).run();

    expect(testDb.db.select().from(proxyKeys).all()).toHaveLength(1);
    expect(testDb.db.select().from(proxyKeyPolicies).all()).toHaveLength(1);
    expect(testDb.db.select().from(modelPrices).all()).toHaveLength(1);
    expect(testDb.db.select().from(proxyUsageEvents).all()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npm test -- src/lib/proxy/schema.test.ts
```

Expected: TypeScript/import failure because the new schema exports do not exist.

- [ ] **Step 3: Add schema tables**

In `src/db/schema.ts`, add these exports after `budgets`:

```ts
export const proxyKeys = sqliteTable("proxy_keys", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  keyHint: text("key_hint").notNull(),
  status: text("status", { enum: ["active", "revoked"] }).notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  revokedAt: text("revoked_at"),
  lastUsedAt: text("last_used_at"),
});

export const proxyKeyPolicies = sqliteTable("proxy_key_policies", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  proxyKeyId: text("proxy_key_id").notNull().references(() => proxyKeys.id),
  provider: text("provider", { enum: ["openai", "anthropic", "gemini"] }).notNull(),
  allowedModelsJson: text("allowed_models_json").notNull(),
  hourlyLimitUsd: real("hourly_limit_usd").notNull(),
  dailyLimitUsd: real("daily_limit_usd").notNull(),
  monthlyLimitUsd: real("monthly_limit_usd").notNull(),
  maxRequestUsd: real("max_request_usd").notNull(),
  maxOutputTokens: integer("max_output_tokens").notNull(),
  maxConcurrency: integer("max_concurrency").notNull().default(1),
  allowTools: integer("allow_tools").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const modelPrices = sqliteTable("model_prices", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  provider: text("provider", { enum: ["openai", "anthropic", "gemini"] }).notNull(),
  model: text("model").notNull(),
  inputUsdPer1m: real("input_usd_per_1m").notNull(),
  cachedInputUsdPer1m: real("cached_input_usd_per_1m"),
  outputUsdPer1m: real("output_usd_per_1m").notNull(),
  active: integer("active").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const proxyUsageEvents = sqliteTable("proxy_usage_events", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  proxyKeyId: text("proxy_key_id").notNull().references(() => proxyKeys.id),
  userId: text("user_id").notNull().references(() => users.id),
  provider: text("provider", { enum: ["openai", "anthropic", "gemini"] }).notNull(),
  endpoint: text("endpoint", { enum: ["responses", "chat_completions"] }).notNull(),
  model: text("model").notNull(),
  status: text("status", { enum: ["reserved", "succeeded", "failed", "usage_unknown"] }).notNull(),
  requestId: text("request_id"),
  providerRequestId: text("provider_request_id"),
  estimatedCostUsd: real("estimated_cost_usd").notNull(),
  reservedCostUsd: real("reserved_cost_usd").notNull(),
  actualCostUsd: real("actual_cost_usd"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  rawUsageJson: text("raw_usage_json"),
  errorCode: text("error_code"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  completedAt: text("completed_at"),
});
```

Add inferred types:

```ts
export type ProxyKey = typeof proxyKeys.$inferSelect;
export type ProxyKeyPolicy = typeof proxyKeyPolicies.$inferSelect;
export type ModelPrice = typeof modelPrices.$inferSelect;
export type ProxyUsageEvent = typeof proxyUsageEvents.$inferSelect;
```

- [ ] **Step 4: Add test DB tables**

Append matching `CREATE TABLE` statements to `src/__tests__/db-helper.ts` inside the existing `sqlite.exec` block.

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- src/lib/proxy/schema.test.ts
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/__tests__/db-helper.ts src/lib/proxy/schema.test.ts
git commit -m "feat: add proxy mode schema"
```

---

## Task 2: Add Virtual Key Generation And Hashing

**Files:**

- Create `src/lib/proxy/key.ts`
- Create `src/lib/proxy/key.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/proxy/key.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createProxyKeySecret, hashProxyKeySecret, keyHint } from "@/lib/proxy/key";

describe("proxy key helpers", () => {
  it("creates an akp-prefixed secret with a safe display hint", () => {
    const secret = createProxyKeySecret();
    expect(secret.startsWith("akp_")).toBe(true);
    expect(secret.length).toBeGreaterThan(40);
    expect(keyHint(secret)).toMatch(/^akp_\.\.\.[A-Za-z0-9_-]{6}$/);
  });

  it("hashes deterministically without storing the raw secret", () => {
    const secret = "akp_test_secret";
    expect(hashProxyKeySecret(secret)).toBe(hashProxyKeySecret(secret));
    expect(hashProxyKeySecret(secret)).not.toContain(secret);
  });
});
```

- [ ] **Step 2: Run test and verify failure**

```bash
npm test -- src/lib/proxy/key.test.ts
```

Expected: import failure.

- [ ] **Step 3: Implement helper**

Create `src/lib/proxy/key.ts`:

```ts
import { createHash, randomBytes } from "crypto";

export function createProxyKeySecret(): string {
  return `akp_${randomBytes(32).toString("base64url")}`;
}

export function hashProxyKeySecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function keyHint(secret: string): string {
  return `akp_...${secret.slice(-6)}`;
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- src/lib/proxy/key.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/proxy/key.ts src/lib/proxy/key.test.ts
git commit -m "feat: add proxy key secret helpers"
```

---

## Task 3: Add Proxy Key Control API

**Files:**

- Create `src/app/api/proxy-keys/route.ts`
- Create `src/app/api/proxy-keys/[id]/route.ts`
- Create `src/app/api/proxy-keys/route.test.ts`
- Create `src/app/api/proxy-keys/delete.test.ts`

- [ ] **Step 1: Implement tests for create/list/revoke**

Cover these cases:

- unauthenticated list/create returns 401
- create stores only `keyHash` and returns raw `key` once
- list returns only current user's proxy keys
- duplicate name for the same user returns 409
- delete/revoke only works for owner or admin

- [ ] **Step 2: Implement `GET` and `POST /api/proxy-keys`**

Behavior:

- Auth uses existing `auth()`.
- Request body:

```ts
{
  name: string;
  allowedModels: string[];
  hourlyLimitUsd: number;
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
  maxRequestUsd: number;
  maxOutputTokens: number;
  maxConcurrency: number;
}
```

- Validation:
  - `name`: same regex as Direct Mode.
  - `allowedModels`: non-empty.
  - all budgets and cost caps must be positive.
  - `hourlyLimitUsd <= dailyLimitUsd <= monthlyLimitUsd`.
  - `maxConcurrency` between 1 and 10.
- Defaults in UI should be conservative, but API must not silently create unlimited keys.

- [ ] **Step 3: Implement `DELETE /api/proxy-keys/[id]` as revoke**

Set:

```ts
status: "revoked",
revokedAt: new Date().toISOString()
```

Do not hard-delete rows because usage events must remain auditable.

- [ ] **Step 4: Run tests**

```bash
npm test -- src/app/api/proxy-keys/route.test.ts src/app/api/proxy-keys/delete.test.ts
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/proxy-keys src/db/schema.ts src/__tests__/db-helper.ts
git commit -m "feat: add proxy key management API"
```

---

## Task 4: Add Pricing And OpenAI Policy Validation

**Files:**

- Create `src/lib/proxy/types.ts`
- Create `src/lib/proxy/pricing.ts`
- Create `src/lib/proxy/pricing.test.ts`
- Create `src/lib/proxy/openai-policy.ts`
- Create `src/lib/proxy/openai-policy.test.ts`

- [ ] **Step 1: Write pricing tests**

Cover:

- active price lookup succeeds
- inactive/unknown model fails closed
- cost calculation uses input and output rates

- [ ] **Step 2: Implement pricing**

`calculateCostUsd` must use:

```ts
inputTokens * inputUsdPer1m / 1_000_000 + outputTokens * outputUsdPer1m / 1_000_000
```

Round only for display. Enforcement must compare unrounded numbers.

- [ ] **Step 3: Write OpenAI policy tests**

Cover:

- Responses requires `model` and `max_output_tokens`.
- Chat Completions requires `model` and either `max_completion_tokens` or legacy `max_tokens`.
- Chat Completions rejects `n > 1`.
- Requests with `tools` are rejected when `allowTools` is false.
- `background: true` is rejected for Responses MVP.
- unknown model is rejected.
- estimated max request cost over policy returns a policy violation.

- [ ] **Step 4: Implement OpenAI body validation**

Expose:

```ts
export type OpenAIProxyEndpoint = "responses" | "chat_completions";

export interface OpenAIPolicyResult {
  ok: true;
  endpoint: OpenAIProxyEndpoint;
  model: string;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  estimatedCostUsd: number;
  normalizedBody: unknown;
} | {
  ok: false;
  status: 400 | 403;
  code: string;
  message: string;
};
```

Use a conservative text estimator for MVP:

```ts
export function estimateTextTokens(value: unknown): number {
  const text = JSON.stringify(value);
  return Math.ceil(text.length / 3);
}
```

Reject request bodies over 1 MB for MVP.

- [ ] **Step 5: Run tests**

```bash
npm test -- src/lib/proxy/pricing.test.ts src/lib/proxy/openai-policy.test.ts
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/proxy/types.ts src/lib/proxy/pricing.ts src/lib/proxy/pricing.test.ts src/lib/proxy/openai-policy.ts src/lib/proxy/openai-policy.test.ts
git commit -m "feat: add openai proxy policy validation"
```

---

## Task 5: Add Redis Budget Reservations

**Files:**

- Modify `package.json`
- Modify `package-lock.json`
- Create `src/lib/proxy/redis.ts`
- Create `src/lib/proxy/reservation.ts`
- Create `src/lib/proxy/reservation.test.ts`

- [ ] **Step 1: Install dependency**

```bash
npm install @upstash/redis
```

- [ ] **Step 2: Write reservation tests with a fake Redis client**

Cover:

- reserves when all budgets have room
- rejects when hourly budget would exceed
- rejects when daily budget would exceed
- rejects when monthly budget would exceed
- rejects when concurrency would exceed
- releases concurrency on completion
- refunds reserved minus actual cost on successful completion

- [ ] **Step 3: Implement Redis client**

`src/lib/proxy/redis.ts`:

```ts
import { Redis } from "@upstash/redis";

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    throw new Error("Redis is not configured");
  }
  redis ??= new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  return redis;
}
```

- [ ] **Step 4: Implement reservation semantics**

Use keys:

- `proxy:budget:hour:{proxyKeyId}:{yyyyMMddHH}`
- `proxy:budget:day:{proxyKeyId}:{yyyyMMdd}`
- `proxy:budget:month:{proxyKeyId}:{yyyyMM}`
- `proxy:concurrency:{proxyKeyId}`

Reservation must be atomic. Use Redis `eval` so all budget and concurrency checks happen in one operation. If `eval` throws, return a fail-closed rejection with status `503`.

- [ ] **Step 5: Run tests**

```bash
npm test -- src/lib/proxy/reservation.test.ts
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/proxy/redis.ts src/lib/proxy/reservation.ts src/lib/proxy/reservation.test.ts
git commit -m "feat: add proxy budget reservations"
```

---

## Task 6: Add Usage Ledger

**Files:**

- Create `src/lib/proxy/usage.ts`
- Create `src/lib/proxy/usage.test.ts`

- [ ] **Step 1: Write usage tests**

Cover:

- creates reserved usage event
- marks success with token usage and actual cost
- marks failure with provider error code
- marks usage unknown when stream terminates without final usage
- updates `proxy_keys.last_used_at`

- [ ] **Step 2: Implement usage helpers**

Expose:

```ts
export async function createReservedUsageEvent(input: {
  proxyKeyId: string;
  userId: string;
  provider: "openai";
  endpoint: "responses" | "chat_completions";
  model: string;
  estimatedCostUsd: number;
  reservedCostUsd: number;
  requestId: string;
}): Promise<string>;
```

Also expose `markUsageSucceeded`, `markUsageFailed`, and `markUsageUnknown`.

- [ ] **Step 3: Run tests**

```bash
npm test -- src/lib/proxy/usage.test.ts
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/proxy/usage.ts src/lib/proxy/usage.test.ts
git commit -m "feat: add proxy usage ledger"
```

---

## Task 7: Add OpenAI Proxy Route Core

**Files:**

- Create `src/lib/proxy/auth.ts`
- Create `src/lib/proxy/openai-forward.ts`
- Create `src/app/api/proxy/openai/v1/responses/route.ts`
- Create `src/app/api/proxy/openai/v1/chat/completions/route.ts`
- Modify `src/middleware.ts`
- Create route tests under `src/app/api/proxy/openai/v1/...`

- [ ] **Step 1: Modify middleware tests first**

Add a test showing `/api/proxy/openai/v1/responses` bypasses NextAuth middleware and reaches route-level bearer auth.

- [ ] **Step 2: Modify middleware**

Add `/api/proxy/` to public API bypass section:

```ts
pathname.startsWith("/api/proxy/")
```

The route itself must authenticate `Authorization: Bearer akp_...`.

- [ ] **Step 3: Implement proxy-key auth helper**

`src/lib/proxy/auth.ts` should:

- parse bearer token
- require `akp_` prefix
- hash token
- find active `proxyKeys` row
- join/load policy
- return 401 for missing/invalid keys
- return 403 for revoked keys

- [ ] **Step 4: Implement OpenAI forwarding helper**

`src/lib/proxy/openai-forward.ts` should:

- require `OPENAI_PROXY_API_KEY`
- forward to `https://api.openai.com/v1/responses` or `/chat/completions`
- preserve `content-type`
- set `authorization: Bearer ${OPENAI_PROXY_API_KEY}`
- pass through non-sensitive OpenAI response headers
- never forward the user's `Authorization` header upstream

- [ ] **Step 5: Implement non-streaming route path**

For `stream !== true`:

1. Authenticate proxy key.
2. Validate request body.
3. Reserve budget.
4. Create reserved usage event.
5. Forward request.
6. Parse JSON response.
7. Extract usage.
8. Mark usage success or failure.
9. Refund unused reservation on success.
10. Return upstream-compatible JSON response.

- [ ] **Step 6: Run route tests**

```bash
npm test -- src/middleware.test.ts src/app/api/proxy/openai/v1/responses/route.test.ts src/app/api/proxy/openai/v1/chat/completions/route.test.ts
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/middleware.ts src/middleware.test.ts src/lib/proxy/auth.ts src/lib/proxy/openai-forward.ts src/app/api/proxy
git commit -m "feat: add openai proxy routes"
```

---

## Task 8: Add Streaming SSE Pass-Through

**Files:**

- Create `src/lib/proxy/sse.ts`
- Create `src/lib/proxy/sse.test.ts`
- Modify `src/lib/proxy/openai-forward.ts`
- Modify OpenAI proxy route tests

- [ ] **Step 1: Write SSE parser tests**

Cover:

- parses `data: {...}\n\n`
- ignores comments and empty frames
- handles chunks split across frame boundaries
- detects Chat Completions final chunk with `usage`
- detects Responses `response.completed` event with `usage`
- passes original bytes through unchanged

- [ ] **Step 2: Implement SSE observer**

Expose:

```ts
export function observeSseStream(input: {
  body: ReadableStream<Uint8Array>;
  onUsage: (usage: { inputTokens: number; outputTokens: number; raw: unknown }) => void;
  onDone: () => void;
  onError: (error: unknown) => void;
}): ReadableStream<Uint8Array>;
```

The returned stream must enqueue the original chunks before or while parsing so client-perceived latency stays low.

- [ ] **Step 3: Force usage-bearing stream options**

For Chat Completions, merge this into the upstream body:

```ts
stream_options: {
  ...existingStreamOptions,
  include_usage: true,
}
```

For Responses, rely on the completed event usage. If final usage is missing, mark event as `usage_unknown`.

- [ ] **Step 4: Add route-level streaming tests**

Mock upstream `fetch` to return a `ReadableStream`. Assert:

- downstream receives the same SSE bytes
- ledger is updated when final usage appears
- concurrency is released when the stream closes
- missing final usage marks `usage_unknown`

- [ ] **Step 5: Run tests**

```bash
npm test -- src/lib/proxy/sse.test.ts src/app/api/proxy/openai/v1/responses/route.test.ts src/app/api/proxy/openai/v1/chat/completions/route.test.ts
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/proxy/sse.ts src/lib/proxy/sse.test.ts src/lib/proxy/openai-forward.ts src/app/api/proxy
git commit -m "feat: support streaming openai proxy responses"
```

---

## Task 9: Add Proxy Mode UI

**Files:**

- Modify `src/hooks/use-keys.ts`
- Modify `src/components/key-create-dialog.tsx`
- Modify `src/components/key-table.tsx`
- Create `src/components/proxy-key-create-dialog.tsx`
- Create `src/components/proxy-key-table.tsx`
- Modify `src/app/dashboard/page.tsx`

- [ ] **Step 1: Rename existing UI copy to Direct Keys**

Update visible labels:

- `Create API Key` -> `Create Direct Key`
- `Your API Keys` -> `Direct Keys`
- description should say these are provider keys for tools that require direct provider credentials.

- [ ] **Step 2: Add `useProxyKeys` hook**

In `src/hooks/use-keys.ts`, add SWR for `/api/proxy-keys`.

- [ ] **Step 3: Add create dialog**

Fields:

- Name
- Allowed models as comma-separated text for MVP
- Hourly limit USD
- Daily limit USD
- Monthly limit USD
- Max request USD
- Max output tokens
- Max concurrency

Default values:

```ts
hourlyLimitUsd: 5
dailyLimitUsd: 20
monthlyLimitUsd: 100
maxRequestUsd: 1
maxOutputTokens: 4096
maxConcurrency: 2
allowedModels: "gpt-5-mini"
```

- [ ] **Step 4: Add proxy table**

Columns:

- Name
- Key Hint
- Allowed Models
- Hourly/Daily/Monthly Budget
- Max Request
- Status
- Last Used
- Actions

- [ ] **Step 5: Add dashboard sections**

Dashboard should show Proxy Keys first and Direct Keys second. Proxy Keys should be visually framed as the recommended default, while Direct Keys should remain available.

- [ ] **Step 6: Run verification**

```bash
npm test
npm run lint
npm run build
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/use-keys.ts src/components src/app/dashboard/page.tsx
git commit -m "feat: add proxy mode dashboard"
```

---

## Task 10: Add Environment And Operational Docs

**Files:**

- Modify `.env.example`
- Modify `README.md`
- Optionally modify `vercel.json`

- [ ] **Step 1: Add environment variables**

Add:

```bash
# Proxy Mode
OPENAI_PROXY_API_KEY="sk-proj-or-service-account-key"
UPSTASH_REDIS_REST_URL=""
UPSTASH_REDIS_REST_TOKEN=""
```

- [ ] **Step 2: Document modes**

README must state:

- Proxy Mode is the default for cost guard.
- Direct Mode is provider key issuance/inventory only.
- Direct Mode does not provide hard budget enforcement.
- Proxy Mode fails closed when Redis or pricing is unavailable.

- [ ] **Step 3: Document supported OpenAI endpoints**

Document:

- `POST https://<aikeyhive>/api/proxy/openai/v1/responses`
- `POST https://<aikeyhive>/api/proxy/openai/v1/chat/completions`

Include a curl example:

```bash
curl https://<aikeyhive>/api/proxy/openai/v1/responses \
  -H "Authorization: Bearer akp_..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5-mini",
    "input": "hello",
    "max_output_tokens": 256
  }'
```

- [ ] **Step 4: Run verification**

```bash
npm test
npm run lint
npm run build
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add .env.example README.md vercel.json
git commit -m "docs: document proxy mode operations"
```

---

## Task 11: Seed Initial Price Catalog

**Files:**

- Create `src/lib/proxy/seed-prices.ts`
- Create `src/app/api/admin/model-prices/route.ts`
- Create `src/app/api/admin/model-prices/route.test.ts`

- [ ] **Step 1: Add admin model price API**

Implement admin-only:

- `GET /api/admin/model-prices`
- `POST /api/admin/model-prices`

Validation:

- provider enum
- model non-empty
- input/output prices positive
- active as boolean

- [ ] **Step 2: Add initial seed helper**

Add a helper that inserts default rows only when no active price exists for a provider/model. Keep the initial list intentionally small:

- `gpt-5-mini`
- `gpt-5-nano`

Use pricing values from current provider docs at implementation time. Do not hard-code guessed values without checking.

- [ ] **Step 3: Run verification**

```bash
npm test -- src/app/api/admin/model-prices/route.test.ts
npm test
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/proxy/seed-prices.ts src/app/api/admin/model-prices
git commit -m "feat: add model price catalog management"
```

---

## Task 12: End-To-End Local Verification

**Files:**

- No new files required unless defects are found.

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: no lint errors.

- [ ] **Step 3: Run production build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Run local app**

```bash
npm run dev
```

Expected: app starts and dashboard loads.

- [ ] **Step 5: Manual proxy smoke test**

With a real `OPENAI_PROXY_API_KEY`, real Redis env vars, and a generated `akp_` key, run:

```bash
curl -N http://localhost:3000/api/proxy/openai/v1/responses \
  -H "Authorization: Bearer akp_REPLACE_ME" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5-mini",
    "input": "Say ok.",
    "max_output_tokens": 16,
    "stream": true
  }'
```

Expected:

- response streams SSE chunks
- usage event is recorded
- Redis concurrency counter returns to zero
- cost reservation is refunded down to actual cost

---

## Self-Review

- Scope coverage: Direct Mode remains lightweight and unchanged except user-facing copy. Proxy Mode gets virtual keys, policy, Redis reservation, OpenAI Responses, Chat Completions, streaming, usage ledger, UI, docs, and verification.
- Placeholder scan: No implementation step relies on "TBD" or unspecified future work. Anthropic/Gemini are explicitly out of scope for MVP.
- Type consistency: Route names use `responses` and `chat_completions`; schema uses `proxyKeys`, `proxyKeyPolicies`, `modelPrices`, and `proxyUsageEvents`; key prefix is consistently `akp_`.

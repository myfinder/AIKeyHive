# Proxy-Owned Upstream Keys And DB Reservations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Proxy Keys own their OpenAI upstream credentials and replace Redis budget reservations with DB-backed reservations.

**Architecture:** Proxy Key creation will create an OpenAI service account key with `OPENAI_ADMIN_KEY`, encrypt the upstream key value, and store its project/service-account identifiers on the proxy key row. Proxy requests will authenticate `akp_...`, reserve budget in the database, decrypt the stored upstream key, forward to OpenAI, then reconcile the DB reservation and usage ledger.

**Tech Stack:** Next.js route handlers, Drizzle/libSQL SQLite schema, AES-256-GCM helpers in `src/lib/crypto.ts`, OpenAI Admin API helpers in `src/lib/providers/openai.ts`, Vitest.

---

### Task 1: Extend Proxy Schema

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/__tests__/db-helper.ts`
- Modify: `src/lib/proxy/schema.test.ts`

- [x] Add proxy key columns for OpenAI project id, service account id, encrypted upstream key, and key hint.
- [x] Add `proxy_budget_reservations` with reservation status, window keys, reserved/actual costs, release/reconcile flags, and timestamps.
- [x] Verify schema tests cover the new columns and table.

### Task 2: Create Upstream Key On Proxy Key Creation

**Files:**
- Modify: `src/app/api/proxy-keys/route.ts`
- Modify: `src/app/api/proxy-keys/route.test.ts`

- [x] Add failing tests that OpenAI proxy key creation calls `createProject`/`createServiceAccountKey`, stores encrypted upstream key data, and returns only `akp_...`.
- [x] Reuse the user's OpenAI project when available, otherwise create and persist one.
- [x] Store the encrypted service account key and service account id on `proxy_keys`.

### Task 3: Forward With Stored Upstream Key

**Files:**
- Modify: `src/lib/proxy/auth.ts`
- Modify: `src/lib/proxy/openai-forward.ts`
- Modify: `src/lib/proxy/openai-route.ts`
- Modify: `src/app/api/proxy/openai/v1/responses/route.test.ts`
- Modify: `src/app/api/proxy/openai/v1/chat/completions/route.test.ts`

- [x] Add tests proving no `OPENAI_PROXY_API_KEY` is required.
- [x] Decrypt the authenticated proxy key's stored upstream key and pass it to the forwarder.
- [x] Fail closed if the stored upstream key is missing or cannot be decrypted.

### Task 4: Replace Redis Reservation With DB Reservation

**Files:**
- Rewrite: `src/lib/proxy/reservation.ts`
- Rewrite: `src/lib/proxy/reservation.test.ts`
- Delete: `src/lib/proxy/redis.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [x] Add tests for hourly/daily/monthly budget limits, concurrency, release idempotency, refund/reconcile idempotency, and unavailable DB handling.
- [x] Implement reservation creation with DB transaction and active reservation aggregation.
- [x] Implement release and refund by updating reservation rows.
- [x] Remove direct `@upstash/redis` dependency if no code references it.

### Task 5: Revoke Upstream Credential

**Files:**
- Modify: `src/app/api/proxy-keys/[id]/route.ts`
- Modify: `src/app/api/proxy-keys/delete.test.ts`

- [x] Add tests that revoking an OpenAI proxy key deletes its service account when project and service account ids exist.
- [x] Keep local revoke successful even if upstream deletion fails, but log the failure.

### Task 6: Docs And Verification

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `README_ja.md`

- [x] Remove `OPENAI_PROXY_API_KEY` and Upstash Redis requirements from Proxy Mode docs.
- [x] Document that Proxy Mode requires `OPENAI_ADMIN_KEY` and `KEY_ENCRYPTION_KEY`.
- [x] Run `npm test`, `npm run lint`, `npx tsc --noEmit --pretty false`, `npm run build`, and `git diff --check`.

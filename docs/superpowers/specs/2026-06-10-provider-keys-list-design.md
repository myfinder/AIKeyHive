# Provider Keys Inventory — Design

Date: 2026-06-10

## Goal

Give admins a live inventory of every API key that actually exists on the provider
side (OpenAI, Anthropic, Gemini), reconciled against AIKeyHive's database, so that
unmanaged ("rogue") keys can be discovered and deleted.

## Requirements

- Admin-only page `/admin/provider-keys`.
- Scope: everything visible with the configured admin credentials:
  - OpenAI: all active projects in the organization, all API keys per project
    (service-account keys and user keys).
  - Anthropic: all active org keys (not limited to `ANTHROPIC_WORKSPACE_ID`).
  - Gemini: all API keys in `GOOGLE_PROJECT_ID`.
- Live fetch on page load (no DB cache). Each provider loads independently
  (progressive rendering); one provider failing or being slow must not block the
  others.
- Reconcile against AIKeyHive DB and label each key **managed** / **unmanaged**:
  - OpenAI: provider key's `owner.service_account.id` matches `api_keys.provider_key_id`.
  - Anthropic: key id exists in `anthropic_key_pool.anthropic_key_id` (any status).
  - Gemini: key id (last path segment of resource name) matches `api_keys.provider_key_id`.
  - Managed keys show the owning user's email.
- Unmanaged keys can be deleted from this page (confirmation dialog). Managed key
  ids are rejected with 409 — managed keys are deleted via the existing dashboard
  flow so DB state stays consistent. Anthropic has no delete API, so "delete"
  archives the key (status → inactive), same as the existing flow.

## Architecture

- `src/lib/provider-keys.ts` — pure reconciliation functions (unit-tested):
  `reconcileOpenAIKeys`, `reconcileAnthropicKeys`, `reconcileGeminiKeys`, each
  returning a common `ProviderKeyEntry` shape
  (`keyId,name,hint,createdAt,location,managed,ownerEmail` + provider-specific
  deletion metadata for OpenAI).
- `src/lib/providers/openai.ts` — add `listProjects()` (paginated) and
  `deleteProjectApiKey(projectId, keyId)` (for user-owned keys; service-account
  keys reuse `deleteServiceAccount`). Extend `listProjectApiKeys` typing with
  `owner`/`created_at` and pagination.
- `GET /api/admin/provider-keys/[provider]` — admin check, live provider fetch,
  DB join, reconcile, return `{ data: ProviderKeyEntry[] }`. Provider API errors
  → 502 with a per-provider message.
- `DELETE /api/admin/provider-keys/[provider]` — body `{keyId, projectId?,
  serviceAccountId?, ownerType?}` (zod-validated). Re-checks managed state in DB
  before deleting; managed → 409.
- UI: `src/components/provider-keys-table.tsx` renders one card per provider via
  a `useAdminProviderKeys(provider)` SWR hook; page `/admin/provider-keys`; nav
  gets an "All Keys" admin item.

## Error handling

- Missing credentials / provider API failure: that provider's card shows an error
  message; the other cards render normally.
- OpenAI fan-out (keys per project) runs in chunks of 5 to stay under rate limits.

## Testing

- Vitest unit tests for the three reconcile functions (managed match, unmanaged,
  owner email mapping, OpenAI user-key vs service-account-key handling).
- Lint + `next build` must pass before release.

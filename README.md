# AIKeyHive

**Unified LLM API key management for teams.**

Organizations using multiple LLM providers (OpenAI, Anthropic, Gemini) face a common challenge: each provider has its own console for key provisioning, its own billing dashboard, and its own usage limits. AIKeyHive brings all of this into a single self-hosted platform so that administrators can issue keys, track spending, and enforce budgets across providers — while individual users get a simple dashboard to request and manage their own keys.

## What problems does it solve?

- **Scattered key management** — Instead of juggling three admin consoles, provision OpenAI, Anthropic, and Gemini API keys from one place.
- **No visibility into costs** — Daily cost aggregation from all providers, broken down by user, model, and provider, with trend charts.
- **Uncontrolled spending** — Set monthly budgets at global or per-user scope. When a budget is exceeded, keys are automatically deleted.
- **Anthropic key limitations** — Anthropic doesn't offer key creation through its Admin API. AIKeyHive works around this with a pool-based model: admins register full key values, and users draw from the pool.
- **Authentication silos** — SSO via any OIDC-compliant IdP (Google Workspace, Okta, Microsoft Entra ID, etc.) with optional domain restriction.

## Features

- **Multi-provider key lifecycle** — Create, view, and delete API keys for OpenAI, Anthropic, and Gemini
- **Cost dashboard** — Daily cost sync via provider APIs and BigQuery, with charts and breakdowns by provider/model (admin only)
- **Budget enforcement** — Monthly spending limits with configurable alert thresholds and automatic key deletion
- **Proxy Mode for OpenAI** — Issue virtual `akp_...` keys for OpenAI requests, with per-key budget and concurrency enforcement through AIKeyHive
- **Anthropic key pool** — Admin registers full key values; users are assigned keys from the pool with one-time display
- **Role-based access** — User and Admin roles with separate dashboards and API permissions
- **SSO authentication** — OIDC-based single sign-on with optional email domain allowlist

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, standalone output) |
| Language | TypeScript, React 19 |
| Database | SQLite (libSQL / Turso) + Drizzle ORM |
| Auth | NextAuth v5 (OIDC) |
| UI | shadcn/ui, Tailwind CSS, Recharts |
| Deployment | Docker / Vercel |

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` — see [.env.example](.env.example) for all available options. The minimum required variables are:

| Variable | Description |
|---|---|
| `AUTH_SECRET` | NextAuth secret (generate with `npx auth secret`) |
| `AUTH_OIDC_ISSUER` | Your OIDC provider's issuer URL |
| `AUTH_OIDC_CLIENT_ID` | OIDC client ID |
| `AUTH_OIDC_CLIENT_SECRET` | OIDC client secret |

Provider-specific variables (`OPENAI_ADMIN_KEY`, `ANTHROPIC_ADMIN_KEY`, `GOOGLE_PROJECT_ID`, etc.) are only needed for the providers you plan to use.

Proxy Mode additionally requires `OPENAI_ADMIN_KEY` and `KEY_ENCRYPTION_KEY`. It creates one upstream OpenAI service account key per Proxy Key and stores that upstream key encrypted in the database.

### 3. Configure your OIDC provider

Register AIKeyHive as a client in your IdP (Google Workspace, Okta, Microsoft Entra ID, etc.) and set the following:

| Setting | Value |
|---|---|
| **Redirect URI (Callback URL)** | `https://<your-domain>/api/auth/callback/oidc` |
| **Sign-out redirect URI** (if required) | `https://<your-domain>` |
| **Allowed scopes** | `openid`, `profile`, `email` |

For local development, use `http://localhost:3000/api/auth/callback/oidc`.

<details>
<summary>Provider-specific examples</summary>

**Google Workspace**
1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Create an OAuth 2.0 Client ID (Web application)
3. Add `http://localhost:3000/api/auth/callback/oidc` to Authorized redirect URIs
4. Set `AUTH_OIDC_ISSUER=https://accounts.google.com`

**Okta**
1. Create a new Web Application in your Okta admin dashboard
2. Set Sign-in redirect URI to `https://<your-domain>/api/auth/callback/oidc`
3. Set `AUTH_OIDC_ISSUER=https://<your-org>.okta.com`

**Microsoft Entra ID**
1. Register an application in Azure Portal → App registrations
2. Add a Web platform redirect URI: `https://<your-domain>/api/auth/callback/oidc`
3. Set `AUTH_OIDC_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0`

</details>

### 4. Set up the database

```bash
npm run db:migrate
```

Vercel runs the same migration command automatically before `next build`.

### 5. Start the dev server

```bash
npm run dev
```

Open http://localhost:3000.

## Docker

```bash
docker build -t aikeyhive .
docker run -p 3000:3000 --env-file .env aikeyhive
```

## Proxy Mode operations

Proxy Keys are virtual `akp_...` keys routed through AIKeyHive. They are the recommended default for budget enforcement because AIKeyHive can reserve spend, enforce concurrency limits, and record proxy usage before forwarding the request upstream.

Direct Keys remain available for tools that require provider-native credentials. Direct-key traffic goes to the provider outside the AIKeyHive proxy, so it cannot be cost-guarded by Proxy Mode.

New Direct Keys require an expiration period from 1 to 366 days unless `No expiration` is explicitly selected. Keys with an expiration are revoked provider-side by the Direct Key expiration cron after they expire. Existing keys migrated without `expires_at` remain no-expiration keys and are not revoked by that cron.

Currently implemented proxy provider/endpoints:

| Provider | Endpoint |
|---|---|
| OpenAI | `POST /api/proxy/openai/v1/responses` |
| OpenAI | `POST /api/proxy/openai/v1/chat/completions` |

Proxy Mode requires:

| Variable | Purpose |
|---|---|
| `OPENAI_ADMIN_KEY` | Creates and revokes the OpenAI service account key owned by each Proxy Key |
| `KEY_ENCRYPTION_KEY` | Encrypts stored upstream OpenAI key values in the AIKeyHive database |

Proxy requests also require an active `model_prices` row for each allowed model. Admins can manage the catalog through `/api/admin/model-prices`, deactivate old active prices with `PATCH /api/admin/model-prices`, and explicitly seed the default OpenAI standard text-token price catalog with `POST /api/admin/model-prices/seed`.
The Proxy Key create form reads `/api/proxy-models` and lets users select only active OpenAI priced models; `POST /api/proxy-keys` also rejects unpriced models.

Proxy Mode fails closed when the stored upstream key is missing or cannot be decrypted, when the database-backed budget reservation cannot be created, or when no active price is configured for the requested model, so missing budget state or pricing cannot silently bypass enforcement.

Example Responses API request using a Proxy Key:

```bash
curl https://<your-domain>/api/proxy/openai/v1/responses \
  -H "Authorization: Bearer akp_your_proxy_key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5-mini",
    "input": "Write a one sentence status update.",
    "max_output_tokens": 64
  }'
```

`max_output_tokens` must be set and must be within the Proxy Key policy.

Current proxy limitations: requests are validated as text-only; Responses background mode is rejected; Chat Completions `n` must be `1`; tools are disabled for keys created from the dashboard. Add explicit support before proxying multimodal, tool-using, or background workloads.

Vercel/serverless deployment note: streaming is supported by the Next route handlers. Budget reservations and concurrency state are stored in the application database, so production deployments should use the shared Turso/libSQL database rather than a local file database. Clients should receive only Proxy Keys; upstream OpenAI service account keys remain encrypted server-side.

## Pages

| Path | Description | Access |
|---|---|---|
| `/` | Login | Public |
| `/dashboard` | Cost summary, direct/proxy key list, key creation | User |
| `/costs` | Cost trends, provider/model breakdowns | Admin |
| `/admin` | User management | Admin |
| `/admin/budgets` | Budget configuration | Admin |
| `/admin/pool` | Anthropic key pool management | Admin |

## API

### User endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/keys` | List your keys |
| `POST` | `/api/keys` | Create a new key |
| `DELETE` | `/api/keys/[id]` | Delete a key |
| `GET` | `/api/costs` | Query cost data (`start`, `end`, `groupBy` params) |
| `GET` | `/api/proxy-keys` | List your Proxy Keys |
| `POST` | `/api/proxy-keys` | Create a Proxy Key |
| `DELETE` | `/api/proxy-keys/[id]` | Revoke a Proxy Key |

### Proxy endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/proxy/openai/v1/responses` | OpenAI Responses API proxy; authenticate with `Authorization: Bearer akp_...` |
| `POST` | `/api/proxy/openai/v1/chat/completions` | OpenAI Chat Completions API proxy; authenticate with `Authorization: Bearer akp_...` |

### Admin endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/users` | List all users |
| `PATCH` | `/api/admin/users/[id]` | Update user role |
| `GET/POST/DELETE` | `/api/admin/budgets` | Budget CRUD |
| `GET/POST` | `/api/admin/pool` | Anthropic key pool management (register key values) |
| `GET/POST/PATCH` | `/api/admin/model-prices` | Model price catalog management |
| `POST` | `/api/admin/model-prices/seed` | Seed default OpenAI model prices |

### Cron jobs

| Path | Schedule | Description |
|---|---|---|
| `/api/cron/sync-costs` | Hourly | Sync costs from all providers, enforce budgets |
| `/api/cron/expire-direct-keys` | Hourly | Revoke expired Direct Keys provider-side and mark them expired |
| `/api/cron/sync-anthropic-pool` | Daily 03:00 UTC | Sync active Anthropic organization keys into the pool |

## Architecture

```
User login (OIDC SSO)
    │
    ▼
JWT session with role
    │
    ▼
Dashboard
  ├── Key creation
  │   ├── Proxy Keys (akp_...) → AIKeyHive proxy → DB budget reservation → OpenAI service account key
  │   ├── OpenAI / Gemini direct keys → direct provisioning via provider API
  │   └── Anthropic → assign from admin-managed pool
  └── Cost overview
    │
    ▼
Scheduled cron
  ├── Fetch costs from provider APIs → store in DB
  ├── Revoke expired Direct Keys provider-side
  └── Check budgets → auto-delete keys on overspend
```

## License

[MIT](LICENSE)

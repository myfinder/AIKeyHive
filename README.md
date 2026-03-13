# AIKeyHive

**Unified LLM API key management for teams.**

Organizations using multiple LLM providers (OpenAI, Anthropic, Gemini) face a common challenge: each provider has its own console for key provisioning, its own billing dashboard, and its own usage limits. AIKeyHive brings all of this into a single self-hosted platform so that administrators can issue keys, track spending, and enforce budgets across providers — while individual users get a simple dashboard to request and manage their own keys.

## What problems does it solve?

- **Scattered key management** — Instead of juggling three admin consoles, provision OpenAI, Anthropic, and Gemini API keys from one place.
- **No visibility into costs** — Daily cost aggregation from all providers, broken down by user, model, and provider, with trend charts.
- **Uncontrolled spending** — Set monthly budgets at global or per-user scope. When a budget is exceeded, keys are automatically disabled.
- **Anthropic key limitations** — Anthropic doesn't offer per-user key generation through its API. AIKeyHive works around this with a pool-based model: admins pre-provision keys, and users draw from the pool.
- **Authentication silos** — SSO via any OIDC-compliant IdP (Google Workspace, Okta, Microsoft Entra ID, etc.) with optional domain restriction.

## Features

- **Multi-provider key lifecycle** — Create, view, and revoke API keys for OpenAI, Anthropic, and Gemini
- **Cost dashboard** — Daily cost sync via provider APIs and BigQuery, with charts and breakdowns by provider/model
- **Budget enforcement** — Monthly spending limits with configurable alert thresholds and automatic key disabling
- **Anthropic key pool** — Admin-managed pool of pre-provisioned keys assigned to users on demand
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

### 3. Set up the database

```bash
npx drizzle-kit push
```

### 4. Start the dev server

```bash
npm run dev
```

Open http://localhost:3000.

## Docker

```bash
docker build -t aikeyhive .
docker run -p 3000:3000 --env-file .env aikeyhive
```

## Pages

| Path | Description | Access |
|---|---|---|
| `/` | Login | Public |
| `/dashboard` | Cost summary, key list, key creation | User |
| `/costs` | Cost trends, provider/model breakdowns | User |
| `/admin` | User management | Admin |
| `/admin/budgets` | Budget configuration | Admin |
| `/admin/pool` | Anthropic key pool management | Admin |

## API

### User endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/keys` | List your keys |
| `POST` | `/api/keys` | Create a new key |
| `DELETE` | `/api/keys/[id]` | Disable a key |
| `GET` | `/api/costs` | Query cost data (`start`, `end`, `groupBy` params) |

### Admin endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/users` | List all users |
| `PATCH` | `/api/admin/users/[id]` | Update user role |
| `GET/POST/DELETE` | `/api/admin/budgets` | Budget CRUD |
| `GET/POST` | `/api/admin/pool` | Anthropic key pool management |
| `POST` | `/api/admin/pool/sync` | Sync pool from Anthropic admin API |

### Cron jobs

| Path | Schedule | Description |
|---|---|---|
| `/api/cron/sync-costs` | Daily 02:00 UTC | Sync costs from all providers, enforce budgets |
| `/api/cron/sync-anthropic-pool` | Daily 03:00 UTC | Sync Anthropic key pool |

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
  │   ├── OpenAI / Gemini → direct provisioning via provider API
  │   └── Anthropic → assign from admin-managed pool
  └── Cost overview
    │
    ▼
Daily cron
  ├── Fetch costs from provider APIs → store in DB
  └── Check budgets → auto-disable keys on overspend
```

## License

[MIT](LICENSE)

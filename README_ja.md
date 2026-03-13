# AIKeyHive

LLM API キーの統合管理プラットフォーム。OpenAI・Anthropic・Gemini のキー発行、コスト追跡、予算管理をひとつのダッシュボードで行えます。

## 主な機能

- **マルチプロバイダー対応** — OpenAI / Anthropic / Gemini のAPIキーを一元管理
- **コスト可視化** — 各プロバイダーの利用料金を日次で自動集計し、チャート表示
- **予算管理** — グローバル / ユーザー単位で月額上限を設定、超過時にキーを自動無効化
- **Anthropic キープール** — 管理者が事前に用意したキーをユーザーに割り当てるプール方式
- **SSO 認証** — OIDC 準拠の IdP（Google Workspace、Okta、Microsoft Entra ID 等）に対応
- **ロールベースアクセス制御** — ユーザー / 管理者の 2 ロール

## 技術スタック

| レイヤー | 技術 |
|---|---|
| フレームワーク | Next.js 16 (App Router, standalone) |
| 言語 | TypeScript, React 19 |
| DB | SQLite (libSQL / Turso) + Drizzle ORM |
| 認証 | NextAuth v5 (OIDC) |
| UI | shadcn/ui, Tailwind CSS, Recharts |
| デプロイ | Docker / Vercel |

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数の設定

```bash
cp .env.example .env
```

`.env` を編集して以下を設定してください：

| 変数名 | 説明 | 必須 |
|---|---|---|
| `AUTH_SECRET` | NextAuth 用シークレット (`npx auth secret` で生成) | Yes |
| `AUTH_OIDC_ISSUER` | OIDC プロバイダーの Issuer URL | Yes |
| `AUTH_OIDC_CLIENT_ID` | OIDC クライアント ID | Yes |
| `AUTH_OIDC_CLIENT_SECRET` | OIDC クライアントシークレット | Yes |
| `DATABASE_URL` | DB 接続先 (デフォルト: `file:local.db`) | No |
| `INITIAL_ADMIN_EMAIL` | 初回ログイン時に管理者になるメールアドレス | No |
| `ALLOWED_EMAIL_DOMAIN` | ログインを許可するメールドメイン | No |
| `OPENAI_ADMIN_KEY` / `OPENAI_ORG_ID` | OpenAI 管理 API | プロバイダー使用時 |
| `ANTHROPIC_ADMIN_KEY` / `ANTHROPIC_ORG_ID` | Anthropic 管理 API | プロバイダー使用時 |
| `GOOGLE_PROJECT_ID` | GCP プロジェクト ID | プロバイダー使用時 |
| `BIGQUERY_BILLING_TABLE` | BigQuery 課金テーブル (Gemini コスト用) | Gemini コスト時 |
| `CRON_SECRET` | Cron エンドポイント認証用シークレット | 本番環境 |

### 3. データベースのセットアップ

```bash
npx drizzle-kit push
```

### 4. 開発サーバーの起動

```bash
npm run dev
```

http://localhost:3000 でアクセスできます。

## Docker で起動

```bash
docker build -t aikeyhive .
docker run -p 3000:3000 --env-file .env aikeyhive
```

## ページ構成

| パス | 説明 | 権限 |
|---|---|---|
| `/` | ログイン画面 | 公開 |
| `/dashboard` | ダッシュボード（コスト概要・キー一覧・キー作成） | ユーザー |
| `/costs` | コスト分析（日次チャート・プロバイダー/モデル別内訳） | ユーザー |
| `/admin` | ユーザー管理（ロール変更） | 管理者 |
| `/admin/budgets` | 予算管理（作成・削除） | 管理者 |
| `/admin/pool` | Anthropic キープール管理 | 管理者 |

## API エンドポイント

### ユーザー向け

| メソッド | パス | 説明 |
|---|---|---|
| `GET` | `/api/keys` | 自分のキー一覧を取得 |
| `POST` | `/api/keys` | 新しいキーを作成 |
| `DELETE` | `/api/keys/[id]` | キーを無効化 |
| `GET` | `/api/costs` | コストデータを取得 (`start`, `end`, `groupBy` パラメータ対応) |

### 管理者向け

| メソッド | パス | 説明 |
|---|---|---|
| `GET` | `/api/admin/users` | 全ユーザー一覧 |
| `PATCH` | `/api/admin/users/[id]` | ユーザーロール変更 |
| `GET/POST/DELETE` | `/api/admin/budgets` | 予算の CRUD |
| `GET/POST` | `/api/admin/pool` | Anthropic キープール管理 |
| `POST` | `/api/admin/pool/sync` | Anthropic キープール同期 |

### Cron ジョブ

| パス | スケジュール | 説明 |
|---|---|---|
| `/api/cron/sync-costs` | 毎日 2:00 UTC | 全プロバイダーのコストを同期し、予算超過チェック |
| `/api/cron/sync-anthropic-pool` | 毎日 3:00 UTC | Anthropic キープールを同期 |

## アーキテクチャ

```
ユーザーログイン (OIDC SSO)
    ↓
JWT セッション確立 (ロール情報含む)
    ↓
ダッシュボード
  ├── キー作成
  │   ├── OpenAI / Gemini → プロバイダー API で直接発行
  │   └── Anthropic → 管理者が用意したプールから割当
  └── コスト確認
    ↓
日次 Cron
  ├── プロバイダー API からコスト取得 → DB に保存
  └── 予算チェック → 超過時はキーを自動無効化
```

## ライセンス

このプロジェクトはプライベートです。

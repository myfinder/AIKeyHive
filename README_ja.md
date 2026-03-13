# AIKeyHive

**チーム向け LLM API キー統合管理プラットフォーム**

複数の LLM プロバイダー（OpenAI、Anthropic、Gemini）を使っている組織では、キーの発行・利用料金の確認・利用上限の管理がプロバイダーごとにバラバラになりがちです。AIKeyHive はこれらをひとつのセルフホスト型プラットフォームに集約し、管理者はキーの発行・コスト追跡・予算管理を一元的に行え、ユーザーはシンプルなダッシュボードから自分のキーを申請・管理できます。

## 解決する課題

- **キー管理の分散** — 3 つの管理コンソールを行き来する代わりに、OpenAI・Anthropic・Gemini の API キーを 1 か所で発行・管理
- **コストの不透明さ** — 全プロバイダーの利用料金を日次で自動集計し、ユーザー・モデル・プロバイダー別に可視化
- **支出の制御** — グローバルまたはユーザー単位で月額予算を設定し、超過時にキーを自動で無効化
- **Anthropic のキー発行制約** — Anthropic は API 経由でのユーザー単位のキー発行に対応していないため、管理者が事前にキーを用意し、ユーザーがプールから取得するモデルで対応
- **認証の統一** — OIDC 準拠の IdP（Google Workspace、Okta、Microsoft Entra ID 等）による SSO。メールドメインによるアクセス制限も可能

## 機能

- **マルチプロバイダーのキーライフサイクル管理** — OpenAI・Anthropic・Gemini の API キーの作成・一覧・無効化
- **コストダッシュボード** — プロバイダー API / BigQuery 経由で日次コストを同期し、チャート・プロバイダー/モデル別の内訳を表示
- **予算管理** — 月額上限とアラート閾値を設定し、超過時にキーを自動無効化
- **Anthropic キープール** — 管理者が事前に用意したキーをユーザーにオンデマンドで割り当て
- **ロールベースアクセス制御** — ユーザーと管理者の 2 ロール、それぞれ専用のダッシュボードと API 権限
- **SSO 認証** — OIDC ベースのシングルサインオン、メールドメインのアクセス制限に対応

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

`.env` を編集してください。利用可能な変数の一覧は [.env.example](.env.example) を参照してください。最低限必要な変数は以下のとおりです：

| 変数名 | 説明 |
|---|---|
| `AUTH_SECRET` | NextAuth 用シークレット (`npx auth secret` で生成) |
| `AUTH_OIDC_ISSUER` | OIDC プロバイダーの Issuer URL |
| `AUTH_OIDC_CLIENT_ID` | OIDC クライアント ID |
| `AUTH_OIDC_CLIENT_SECRET` | OIDC クライアントシークレット |

プロバイダー固有の変数（`OPENAI_ADMIN_KEY`、`ANTHROPIC_ADMIN_KEY`、`GOOGLE_PROJECT_ID` など）は、利用するプロバイダーのもののみ設定すれば十分です。

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
| `/dashboard` | コスト概要・キー一覧・キー作成 | ユーザー |
| `/costs` | コスト推移チャート・プロバイダー/モデル別内訳 | ユーザー |
| `/admin` | ユーザー管理 | 管理者 |
| `/admin/budgets` | 予算管理 | 管理者 |
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
    │
    ▼
JWT セッション確立 (ロール情報含む)
    │
    ▼
ダッシュボード
  ├── キー作成
  │   ├── OpenAI / Gemini → プロバイダー API で直接発行
  │   └── Anthropic → 管理者が用意したプールから割当
  └── コスト確認
    │
    ▼
日次 Cron
  ├── プロバイダー API からコスト取得 → DB に保存
  └── 予算チェック → 超過時はキーを自動無効化
```

## ライセンス

[MIT](LICENSE)

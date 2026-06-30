# AIKeyHive

**チーム向け LLM API キー統合管理プラットフォーム**

複数の LLM プロバイダー（OpenAI、Anthropic、Gemini）を使っている組織では、キーの発行・利用料金の確認・利用上限の管理がプロバイダーごとにバラバラになりがちです。AIKeyHive はこれらをひとつのセルフホスト型プラットフォームに集約し、管理者はキーの発行・コスト追跡・予算管理を一元的に行え、ユーザーはシンプルなダッシュボードから自分のキーを申請・管理できます。

## 解決する課題

- **キー管理の分散** — 3 つの管理コンソールを行き来する代わりに、OpenAI・Anthropic・Gemini の API キーを 1 か所で発行・管理
- **コストの不透明さ** — 全プロバイダーの利用料金を日次で自動集計し、ユーザー・モデル・プロバイダー別に可視化
- **支出の制御** — グローバルまたはユーザー単位で月額予算を設定し、超過時にキーを自動で削除
- **Anthropic のキー発行制約** — Anthropic は Admin API 経由でのキー作成に対応していないため、管理者がフルキー値を登録し、ユーザーがプールから取得するモデルで対応
- **認証の統一** — OIDC 準拠の IdP（Google Workspace、Okta、Microsoft Entra ID 等）による SSO。メールドメインによるアクセス制限も可能

## 機能

- **マルチプロバイダーのキーライフサイクル管理** — OpenAI・Anthropic・Gemini の API キーの作成・一覧・削除
- **コストダッシュボード** — プロバイダー API / BigQuery 経由で日次コストを同期し、チャート・プロバイダー/モデル別の内訳を表示（管理者のみ）
- **予算管理** — 月額上限とアラート閾値を設定し、超過時にキーを自動削除
- **OpenAI Proxy Mode** — OpenAI リクエスト用の仮想 `akp_...` キーを発行し、AIKeyHive 経由でキー単位の予算と同時実行数を制御
- **Anthropic キープール** — 管理者がフルキー値を登録し、ユーザーにオンデマンドで割り当て（キーは作成時に一度だけ表示）
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

Proxy Mode を利用する場合は、追加で `OPENAI_ADMIN_KEY` と `KEY_ENCRYPTION_KEY` が必要です。Proxy Key ごとに上流 OpenAI service account key を作成し、その上流キーをデータベースに暗号化して保存します。

### 3. OIDC プロバイダーの設定

お使いの IdP（Google Workspace、Okta、Microsoft Entra ID 等）に AIKeyHive をクライアントとして登録し、以下を設定してください：

| 設定項目 | 値 |
|---|---|
| **リダイレクト URI（コールバック URL）** | `https://<your-domain>/api/auth/callback/oidc` |
| **サインアウト後のリダイレクト URI**（必要な場合） | `https://<your-domain>` |
| **許可するスコープ** | `openid`, `profile`, `email` |

ローカル開発時は `http://localhost:3000/api/auth/callback/oidc` を使用してください。

<details>
<summary>プロバイダー別の設定例</summary>

**Google Workspace**
1. [Google Cloud Console](https://console.cloud.google.com/) → API とサービス → 認証情報 を開く
2. OAuth 2.0 クライアント ID を作成（ウェブアプリケーション）
3. 承認済みのリダイレクト URI に `http://localhost:3000/api/auth/callback/oidc` を追加
4. `AUTH_OIDC_ISSUER=https://accounts.google.com` を設定

**Okta**
1. Okta 管理画面で Web Application を作成
2. Sign-in redirect URI に `https://<your-domain>/api/auth/callback/oidc` を設定
3. `AUTH_OIDC_ISSUER=https://<your-org>.okta.com` を設定

**Microsoft Entra ID**
1. Azure Portal → アプリの登録 でアプリケーションを登録
2. Web プラットフォームのリダイレクト URI に `https://<your-domain>/api/auth/callback/oidc` を追加
3. `AUTH_OIDC_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0` を設定

</details>

### 4. データベースのセットアップ

```bash
npm run db:migrate
```

Vercel では `next build` の前に同じ migration コマンドが自動実行されます。

### 5. 開発サーバーの起動

```bash
npm run dev
```

http://localhost:3000 でアクセスできます。

## Docker で起動

```bash
docker build -t aikeyhive .
docker run -p 3000:3000 --env-file .env aikeyhive
```

## Proxy Mode 運用

Proxy Key は、AIKeyHive 経由でルーティングされる仮想的な `akp_...` キーです。AIKeyHive が上流プロバイダーへ転送する前に予算予約・同時実行数制限・プロキシ利用記録を行えるため、予算管理を効かせたい用途では Proxy Key を標準にすることを推奨します。

Direct Key は、プロバイダー純正の認証情報を要求するツール向けに引き続き利用できます。Direct Key のトラフィックは AIKeyHive プロキシを経由しないため、Proxy Mode ではコストガードできません。

新規 Direct Key は、`No expiration` を明示的に選択しない限り 1〜366 日の有効期限が必須です。有効期限付きのキーは、期限到来後に Direct Key 失効 cron がプロバイダー側で失効し、AIKeyHive 上では expired として記録します。`expires_at` なしで移行された既存キーは無期限扱いとなり、この cron では失効されません。

現在実装されているプロキシプロバイダー / エンドポイントは以下です：

| プロバイダー | エンドポイント |
|---|---|
| OpenAI | `POST /api/proxy/openai/v1/responses` |
| OpenAI | `POST /api/proxy/openai/v1/chat/completions` |

Proxy Mode には以下の環境変数が必要です：

| 変数名 | 用途 |
|---|---|
| `OPENAI_ADMIN_KEY` | Proxy Key が所有する OpenAI service account key の作成・失効 |
| `KEY_ENCRYPTION_KEY` | AIKeyHive DB に保存する上流 OpenAI キー値の暗号化 |

プロキシリクエストには、許可モデルごとに有効な `model_prices` 行も必要です。管理者は `/api/admin/model-prices` で価格カタログを管理し、`POST /api/admin/model-prices/seed` で OpenAI の標準テキストトークン価格カタログを明示的に seed できます。
Proxy Key 作成フォームは `/api/proxy-models` を読み込み、有効な OpenAI 価格があるモデルだけを選択肢として表示します。`POST /api/proxy-keys` 側でも価格未登録モデルは拒否します。

保存済みの上流キーが存在しない / 復号できない場合、DB ベースの予算予約を作成できない場合、またはリクエストされたモデルの有効な価格がない場合、Proxy Mode は fail-closed でリクエストを拒否します。予算状態や価格が欠けている状態で enforcement が静かに迂回されることはありません。

Proxy Key を使った Responses API リクエスト例：

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

`max_output_tokens` は必須で、Proxy Key のポリシー内に収める必要があります。

現在のプロキシ制限：リクエストはテキストのみとして検証されます。Responses の background mode は拒否されます。Chat Completions の `n` は `1` である必要があります。ダッシュボードから作成したキーでは tools は無効です。マルチモーダル、tools 利用、background workload をプロキシする場合は、明示的な対応を追加してください。

Vercel / serverless でのデプロイ時は、Next route handler によるストリーミングがサポートされています。予算予約と同時実行数の状態はアプリケーション DB に保存されるため、本番ではローカルファイル DB ではなく共有された Turso / libSQL DB を使用してください。クライアントには Proxy Key だけを渡し、上流 OpenAI service account key はサーバー側で暗号化保存します。

## ページ構成

| パス | 説明 | 権限 |
|---|---|---|
| `/` | ログイン画面 | 公開 |
| `/dashboard` | コスト概要・Direct / Proxy Key 一覧・キー作成 | ユーザー |
| `/costs` | コスト推移チャート・プロバイダー/モデル別内訳 | 管理者 |
| `/admin` | ユーザー管理 | 管理者 |
| `/admin/budgets` | 予算管理 | 管理者 |
| `/admin/pool` | Anthropic キープール管理 | 管理者 |

## API エンドポイント

### ユーザー向け

| メソッド | パス | 説明 |
|---|---|---|
| `GET` | `/api/keys` | 自分のキー一覧を取得 |
| `POST` | `/api/keys` | 新しいキーを作成 |
| `DELETE` | `/api/keys/[id]` | キーを削除 |
| `GET` | `/api/costs` | コストデータを取得 (`start`, `end`, `groupBy` パラメータ対応) |
| `GET` | `/api/proxy-keys` | 自分の Proxy Key 一覧を取得 |
| `POST` | `/api/proxy-keys` | Proxy Key を作成 |
| `DELETE` | `/api/proxy-keys/[id]` | Proxy Key を失効 |

### プロキシエンドポイント

| メソッド | パス | 説明 |
|---|---|---|
| `POST` | `/api/proxy/openai/v1/responses` | OpenAI Responses API プロキシ。`Authorization: Bearer akp_...` で認証 |
| `POST` | `/api/proxy/openai/v1/chat/completions` | OpenAI Chat Completions API プロキシ。`Authorization: Bearer akp_...` で認証 |

### 管理者向け

| メソッド | パス | 説明 |
|---|---|---|
| `GET` | `/api/admin/users` | 全ユーザー一覧 |
| `PATCH` | `/api/admin/users/[id]` | ユーザーロール変更 |
| `GET/POST/DELETE` | `/api/admin/budgets` | 予算の CRUD |
| `GET/POST` | `/api/admin/pool` | Anthropic キープール管理（フルキー値の登録） |
| `GET/POST` | `/api/admin/model-prices` | モデル価格カタログ管理 |
| `POST` | `/api/admin/model-prices/seed` | OpenAI デフォルトモデル価格 seed |

### Cron ジョブ

| パス | スケジュール | 説明 |
|---|---|---|
| `/api/cron/sync-costs` | 毎時 | 全プロバイダーのコストを同期し、予算超過チェック |
| `/api/cron/expire-direct-keys` | 毎時 | 期限切れ Direct Key をプロバイダー側で失効し、expired として記録 |
| `/api/cron/sync-anthropic-pool` | 毎日 3:00 UTC | Anthropic organization の有効キーをプールへ同期 |

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
  │   ├── Proxy Key (akp_...) → AIKeyHive プロキシ → DB 予算予約 → OpenAI service account key
  │   ├── OpenAI / Gemini Direct Key → プロバイダー API で直接発行
  │   └── Anthropic → 管理者が用意したプールから割当
  └── コスト確認
    │
    ▼
定期 Cron
  ├── プロバイダー API からコスト取得 → DB に保存
  ├── 期限切れ Direct Key をプロバイダー側で失効
  └── 予算チェック → 超過時はキーを自動削除
```

## ライセンス

[MIT](LICENSE)

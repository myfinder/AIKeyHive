# API Key "Last Used" 表示 — 設計

日付: 2026-06-10
ステータス: 承認済み

## 目的

ユーザーダッシュボード（`/dashboard`）と管理者の Provider Keys ページ（`/admin/provider-keys`）の API キー一覧に「Last Used（最終使用日）」列を追加する。

## 方針

DB にカラムは追加せず、表示のたびにプロバイダ API からライブ取得する（ユーザー選択: 案B）。常に最新の値が見られる代わりに、ページ読み込みごとにプロバイダ API を最大2本呼ぶ。並行取得でレイテンシを軽減する。

## データソース

| プロバイダ | 取得方法 | 精度 |
|---|---|---|
| OpenAI | プロジェクト API キー一覧 `GET /v1/organization/projects/{id}/api_keys` が返す `last_used_at`（Unix 秒）をそのまま利用 | 正確なタイムスタンプ |
| Anthropic | Usage Report API `GET /v1/organizations/usage_report/messages` を `group_by[]=api_key_id`、`bucket_width=1d`、直近30日（`limit=31`）で取得し、キーごとに使用実績のある最後の日付を採用 | 日単位。30日より前の使用は検出不可 → 「—」 |
| Gemini | キー単位の使用情報を取得する API がない | 常に「—」 |

## 変更内容

### 1. `src/lib/providers/openai.ts`

- `OpenAIProjectApiKey` インターフェースに `last_used_at?: number` を追加。API は既にこのフィールドを返しているため、型定義の追加のみ。

### 2. `src/lib/providers/anthropic.ts`

- 新関数 `fetchLastUsedByApiKey(lookbackDays = 30): Promise<Map<string, string>>` を追加。
  - Usage Report API を上記パラメータで呼び、バケットを走査して api_key_id ごとに使用（トークン > 0）があった最後のバケット日付（ISO 日付文字列）を Map で返す。
  - ページネーション（`has_more` / `next_page`）に対応する。

### 3. `GET /api/keys`（ユーザーダッシュボード用エンドポイント）

- DB からキー取得後、ユーザーが持つプロバイダに応じて並行でライブ取得:
  - OpenAI キーがある場合: `users.openaiProjectId` のプロジェクトに対して `listProjectApiKeys()` を呼び、`providerKeyId` で突き合わせて `last_used_at` を取得。
  - Anthropic キーがある場合: `fetchLastUsedByApiKey()` の Map と `providerKeyId` を突き合わせ。
  - Gemini キー: 常に null。
- レスポンスの各キーに `lastUsedAt: string | null`（ISO 文字列）を追加。
- **プロバイダ API の失敗はキー一覧表示を壊さない**: 失敗時は該当プロバイダの `lastUsedAt` を null とし、エラーは `console.error` でログのみ。

### 4. `GET /api/admin/provider-keys/[provider]`（管理者用）

- OpenAI: 既存のライブ取得（`listProjectApiKeys`）結果から `last_used_at` をレスポンスにパススルー。
- Anthropic: `fetchLastUsedByApiKey()` の結果をキー ID で突き合わせて付与。
- Gemini: null。
- 各キーのレスポンスに `lastUsedAt: string | null` を追加。

### 5. UI

- `src/components/key-table.tsx`: 「Last Used」列を Created 列の隣に追加。
- `src/components/provider-keys-table.tsx`: 同様に「Last Used」列を追加。
- 表示フォーマットは既存の Created 列と同じ（日付のみ）。null は「—」。

## エラーハンドリング

- プロバイダ API のエラー・タイムアウトはすべて握りつぶして null 表示（ログには残す）。キー一覧自体の表示は常に成功させる。
- Anthropic Usage Report に使用実績がないキー（30日以上未使用 or 一度も未使用）は「—」。

## テスト

- Anthropic Usage Report レスポンスのパース処理（最終使用日の抽出、ページネーション、ゼロ使用バケットの無視）に vitest ユニットテストを追加（既存 `gemini.test.ts` のパターンに準拠）。
- ブラウザでの実機確認: `/dashboard` と `/admin/provider-keys`（openai / anthropic / gemini の3タブすべて）を開き、Last Used 列の表示・「—」フォールバック・既存機能の非破壊を確認。

## スコープ外

- DB への lastUsedAt 永続化・cron 同期（案A として検討したが不採用）
- Gemini の BigQuery 課金データからの推定
- レスポンスのキャッシュ（遅延が問題になったら後日検討）

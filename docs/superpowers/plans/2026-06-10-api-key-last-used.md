# API Key "Last Used" 表示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ユーザーダッシュボードと管理者 Provider Keys ページのキー一覧に、プロバイダAPIからライブ取得した「Last Used」列を追加する。

**Architecture:** DBカラムは追加しない。OpenAI はキー一覧APIの `last_used_at` をパススルー。Anthropic は Usage Report API（`group_by[]=api_key_id`, `bucket_width=1d`, 直近30日）から最終使用日を推定。Gemini は常に null。プロバイダAPI失敗時は null にフォールバックし、一覧表示は壊さない。

**Tech Stack:** Next.js 16 App Router / Drizzle + SQLite / SWR / vitest

Spec: `docs/superpowers/specs/2026-06-10-api-key-last-used-design.md`

---

### Task 1: Anthropic `fetchLastUsedByApiKey()`（TDD）

**Files:**
- Test: `src/lib/providers/anthropic.test.ts`（新規）
- Modify: `src/lib/providers/anthropic.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/providers/anthropic.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchLastUsedByApiKey } from "@/lib/providers/anthropic";

function usageResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

describe("fetchLastUsedByApiKey", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_ADMIN_KEY", "sk-ant-admin-test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns the latest bucket date with usage per api key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        usageResponse({
          data: [
            {
              starting_at: "2026-06-01T00:00:00Z",
              ending_at: "2026-06-02T00:00:00Z",
              results: [
                { api_key_id: "key_a", uncached_input_tokens: 10, output_tokens: 5 },
                { api_key_id: "key_b", uncached_input_tokens: 1, output_tokens: 0 },
              ],
            },
            {
              starting_at: "2026-06-05T00:00:00Z",
              ending_at: "2026-06-06T00:00:00Z",
              results: [
                { api_key_id: "key_a", uncached_input_tokens: 3, output_tokens: 2 },
              ],
            },
          ],
          has_more: false,
        })
      )
    );

    const map = await fetchLastUsedByApiKey();
    expect(map.get("key_a")).toBe("2026-06-05T00:00:00Z");
    expect(map.get("key_b")).toBe("2026-06-01T00:00:00Z");
  });

  it("ignores zero-usage results and null api_key_id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        usageResponse({
          data: [
            {
              starting_at: "2026-06-03T00:00:00Z",
              ending_at: "2026-06-04T00:00:00Z",
              results: [
                { api_key_id: "key_zero", uncached_input_tokens: 0, output_tokens: 0 },
                { api_key_id: null, uncached_input_tokens: 100, output_tokens: 50 },
              ],
            },
          ],
          has_more: false,
        })
      )
    );

    const map = await fetchLastUsedByApiKey();
    expect(map.size).toBe(0);
  });

  it("follows pagination via next_page", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        usageResponse({
          data: [
            {
              starting_at: "2026-06-01T00:00:00Z",
              ending_at: "2026-06-02T00:00:00Z",
              results: [{ api_key_id: "key_a", uncached_input_tokens: 1, output_tokens: 0 }],
            },
          ],
          has_more: true,
          next_page: "page_xyz",
        })
      )
      .mockResolvedValueOnce(
        usageResponse({
          data: [
            {
              starting_at: "2026-06-07T00:00:00Z",
              ending_at: "2026-06-08T00:00:00Z",
              results: [{ api_key_id: "key_a", uncached_input_tokens: 2, output_tokens: 0 }],
            },
          ],
          has_more: false,
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const map = await fetchLastUsedByApiKey();
    expect(map.get("key_a")).toBe("2026-06-07T00:00:00Z");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondUrl = fetchMock.mock.calls[1][0] as string;
    expect(secondUrl).toContain("page=page_xyz");
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403 } as Response)
    );
    await expect(fetchLastUsedByApiKey()).rejects.toThrow(
      "Anthropic fetchLastUsedByApiKey failed: 403"
    );
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/lib/providers/anthropic.test.ts`
Expected: FAIL（`fetchLastUsedByApiKey` が未定義）

- [ ] **Step 3: 実装**

`src/lib/providers/anthropic.ts` の末尾に追加:

```typescript
interface UsageResult {
  api_key_id: string | null;
  uncached_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

interface UsageBucket {
  starting_at: string;
  ending_at: string;
  results: UsageResult[];
}

/**
 * Estimate each API key's last-used date from the Usage Report API.
 * Day granularity; keys unused within the lookback window are absent.
 */
export async function fetchLastUsedByApiKey(
  lookbackDays = 30
): Promise<Map<string, string>> {
  const start = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  start.setUTCHours(0, 0, 0, 0);

  const lastUsed = new Map<string, string>();
  let page: string | undefined;
  do {
    const params = new URLSearchParams();
    params.append("starting_at", start.toISOString());
    params.append("bucket_width", "1d");
    params.append("group_by[]", "api_key_id");
    params.append("limit", "31");
    if (page) params.append("page", page);

    const res = await fetch(
      `${ANTHROPIC_API_BASE}/organizations/usage_report/messages?${params}`,
      { headers: headers(), cache: "no-store" }
    );
    if (!res.ok)
      throw new Error(`Anthropic fetchLastUsedByApiKey failed: ${res.status}`);

    const data = (await res.json()) as {
      data: UsageBucket[];
      has_more: boolean;
      next_page?: string;
    };
    for (const bucket of data.data || []) {
      for (const result of bucket.results || []) {
        if (!result.api_key_id) continue;
        const tokens =
          (result.uncached_input_tokens || 0) +
          (result.cache_read_input_tokens || 0) +
          (result.output_tokens || 0);
        if (tokens === 0) continue;
        const prev = lastUsed.get(result.api_key_id);
        if (!prev || bucket.starting_at > prev) {
          lastUsed.set(result.api_key_id, bucket.starting_at);
        }
      }
    }
    page = data.has_more ? data.next_page : undefined;
  } while (page);

  return lastUsed;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/providers/anthropic.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/anthropic.ts src/lib/providers/anthropic.test.ts
git commit -m "Add Anthropic last-used lookup via Usage Report API"
```

---

### Task 2: OpenAI 型 + ProviderKeyEntry / reconcile に lastUsedAt を追加

**Files:**
- Modify: `src/lib/providers/openai.ts:16-26`
- Modify: `src/lib/provider-keys.ts`
- Test: 既存 vitest がないため reconcile はテスト追加（`src/lib/provider-keys.test.ts` 新規）

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/provider-keys.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { reconcileOpenAIKeys, reconcileAnthropicKeys } from "@/lib/provider-keys";

describe("lastUsedAt reconciliation", () => {
  it("maps OpenAI last_used_at (unix seconds) to ISO string", () => {
    const entries = reconcileOpenAIKeys(
      [{ id: "proj_1", name: "Project One" }],
      {
        proj_1: [
          {
            id: "key_1",
            name: "k",
            redacted_value: "sk-...abcd",
            created_at: 1700000000,
            last_used_at: 1765000000,
            owner: { type: "service_account", service_account: { id: "sa_1" } },
          },
        ],
      },
      []
    );
    expect(entries[0].lastUsedAt).toBe(new Date(1765000000 * 1000).toISOString());
  });

  it("sets OpenAI lastUsedAt null when absent", () => {
    const entries = reconcileOpenAIKeys(
      [{ id: "proj_1", name: "Project One" }],
      { proj_1: [{ id: "key_1", name: "k", redacted_value: "sk-...abcd" }] },
      []
    );
    expect(entries[0].lastUsedAt).toBeNull();
  });

  it("attaches Anthropic lastUsedAt from the usage map", () => {
    const entries = reconcileAnthropicKeys(
      [
        { id: "ak_1", name: "a", partial_key_hint: "...aaaa", workspace_id: null, status: "active" },
        { id: "ak_2", name: "b", partial_key_hint: "...bbbb", workspace_id: null, status: "active" },
      ],
      [],
      new Map([["ak_1", "2026-06-05T00:00:00Z"]])
    );
    expect(entries[0].lastUsedAt).toBe("2026-06-05T00:00:00Z");
    expect(entries[1].lastUsedAt).toBeNull();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/lib/provider-keys.test.ts`
Expected: FAIL（`lastUsedAt` プロパティが存在しない / 引数不一致）

- [ ] **Step 3: 実装**

`src/lib/providers/openai.ts` — `OpenAIProjectApiKey` に追加（`created_at?: number;` の次の行）:

```typescript
  last_used_at?: number | null;
```

`src/lib/provider-keys.ts`:

1. `ProviderKeyEntry` に `lastUsedAt: string | null;` を追加（`createdAt` の次）
2. `reconcileOpenAIKeys` の返却オブジェクトに追加:

```typescript
        lastUsedAt: key.last_used_at
          ? new Date(key.last_used_at * 1000).toISOString()
          : null,
```

3. `reconcileAnthropicKeys` のシグネチャを変更し、返却オブジェクトに追加:

```typescript
export function reconcileAnthropicKeys(
  orgKeys: AnthropicApiKey[],
  poolRows: PoolKeyRow[],
  lastUsedById: Map<string, string> = new Map()
): ProviderKeyEntry[] {
  ...
      lastUsedAt: lastUsedById.get(key.id) || null,
```

4. `reconcileGeminiKeys` の返却オブジェクトに `lastUsedAt: null,` を追加

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run`
Expected: 全テスト PASS（既存 gemini.test.ts 含む）

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/openai.ts src/lib/provider-keys.ts src/lib/provider-keys.test.ts
git commit -m "Add lastUsedAt to provider key reconciliation"
```

---

### Task 3: 管理者 API ルートで Anthropic usage map を取得

**Files:**
- Modify: `src/app/api/admin/provider-keys/[provider]/route.ts:52-63`

- [ ] **Step 1: `listAnthropic` を変更**

```typescript
async function listAnthropic(): Promise<ProviderKeyEntry[]> {
  const [{ data: orgKeys }, lastUsedById] = await Promise.all([
    anthropic.listOrgKeys(),
    anthropic.fetchLastUsedByApiKey().catch((error) => {
      console.error("Anthropic last-used lookup failed:", error);
      return new Map<string, string>();
    }),
  ]);
  const pool = await db
    .select({
      anthropicKeyId: anthropicKeyPool.anthropicKeyId,
      assignedToEmail: users.email,
    })
    .from(anthropicKeyPool)
    .leftJoin(users, eq(anthropicKeyPool.assignedTo, users.id))
    .all();
  return reconcileAnthropicKeys(orgKeys, pool, lastUsedById);
}
```

（OpenAI は `listProjectApiKeys` の `last_used_at` が Task 2 の reconcile でパススルーされるため変更不要。Gemini も変更不要。）

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/provider-keys/[provider]/route.ts
git commit -m "Fetch Anthropic last-used dates in admin provider keys API"
```

---

### Task 4: `GET /api/keys` に lastUsedAt を追加

**Files:**
- Modify: `src/app/api/keys/route.ts:16-35`

- [ ] **Step 1: GET ハンドラを置き換え**

import に追加: `import * as anthropic from "@/lib/providers/anthropic";`

```typescript
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keys = await db
    .select({
      id: apiKeys.id,
      provider: apiKeys.provider,
      name: apiKeys.name,
      keyHint: apiKeys.keyHint,
      createdAt: apiKeys.createdAt,
      providerKeyId: apiKeys.providerKeyId,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, session.user.id))
    .all();

  // Live last-used lookup; failures degrade to null without breaking the list
  const [openaiLastUsed, anthropicLastUsed] = await Promise.all([
    fetchOpenAILastUsed(session.user.id, keys),
    fetchAnthropicLastUsed(keys),
  ]);

  return NextResponse.json({
    data: keys.map(({ providerKeyId, ...key }) => ({
      ...key,
      lastUsedAt:
        (providerKeyId &&
          (key.provider === "openai"
            ? openaiLastUsed.get(providerKeyId)
            : key.provider === "anthropic"
              ? anthropicLastUsed.get(providerKeyId)
              : null)) ||
        null,
    })),
  });
}

type KeyRow = { provider: string; providerKeyId: string | null };

// OpenAI: providerKeyId is the service-account id; the key list carries last_used_at
async function fetchOpenAILastUsed(
  userId: string,
  keys: KeyRow[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!keys.some((k) => k.provider === "openai")) return map;
  try {
    const user = await db.select().from(users).where(eq(users.id, userId)).get();
    if (!user?.openaiProjectId) return map;
    const { data } = await openai.listProjectApiKeys(user.openaiProjectId);
    for (const key of data) {
      const saId = key.owner?.service_account?.id;
      if (saId && key.last_used_at) {
        map.set(saId, new Date(key.last_used_at * 1000).toISOString());
      }
    }
  } catch (error) {
    console.error("OpenAI last-used lookup failed:", error);
  }
  return map;
}

async function fetchAnthropicLastUsed(keys: KeyRow[]): Promise<Map<string, string>> {
  if (!keys.some((k) => k.provider === "anthropic")) return new Map();
  try {
    return await anthropic.fetchLastUsedByApiKey();
  } catch (error) {
    console.error("Anthropic last-used lookup failed:", error);
    return new Map();
  }
}
```

注意: レスポンスから `providerKeyId` は除外する（map で分割代入して捨てる。従来通りクライアントに返さない）。

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 3: Commit**

```bash
git add src/app/api/keys/route.ts
git commit -m "Return lastUsedAt from user keys API"
```

---

### Task 5: UI — Last Used 列の追加

**Files:**
- Modify: `src/hooks/use-keys.ts:1-20`
- Modify: `src/components/key-table.tsx`
- Modify: `src/components/provider-keys-table.tsx`

- [ ] **Step 1: `use-keys.ts` の `useKeys` の型を拡張**

```typescript
export type DashboardKey = Pick<
  ApiKey,
  "id" | "provider" | "name" | "keyHint" | "createdAt"
> & { lastUsedAt: string | null };

export function useKeys() {
  const { data, error, isLoading, mutate } = useSWR<{ data: DashboardKey[] }>(
    "/api/keys",
    fetcher
  );
  ...
}
```

- [ ] **Step 2: `key-table.tsx` — Created 列の後に Last Used 列を追加**

ヘッダ（`<TableHead>Created</TableHead>` の次）:

```tsx
          <TableHead>Last Used</TableHead>
```

ボディ（Created セルの次）:

```tsx
            <TableCell className="text-sm text-muted-foreground">
              {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : "—"}
            </TableCell>
```

- [ ] **Step 3: `provider-keys-table.tsx` — Created 列の後に Last Used 列を追加**

ヘッダ（`<TableHead>Created</TableHead>` の次）:

```tsx
            <TableHead>Last Used</TableHead>
```

ボディ（Created セルの次）:

```tsx
              <TableCell className="text-sm text-muted-foreground">
                {entry.lastUsedAt
                  ? new Date(entry.lastUsedAt).toLocaleDateString()
                  : "—"}
              </TableCell>
```

- [ ] **Step 4: lint + 型チェック + 全テスト**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: すべて成功

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-keys.ts src/components/key-table.tsx src/components/provider-keys-table.tsx
git commit -m "Show Last Used column in key tables"
```

---

### Task 6: 検証とリリース

- [ ] **Step 1: ビルド確認**

Run: `npm run build`
Expected: 成功

- [ ] **Step 2: ブラウザ実機確認（全画面・全プロバイダ）**

`npm run dev` を起動し、以下をすべて確認:

1. `/dashboard` — キー一覧に Last Used 列が表示される（値 or「—」）
2. `/admin/provider-keys` — OpenAI タブ: last_used_at が表示される
3. `/admin/provider-keys` — Anthropic タブ: usage 由来の日付 or「—」
4. `/admin/provider-keys` — Gemini タブ: 「—」表示で既存列が壊れていない
5. プロバイダAPI失敗時（admin key 未設定等）でも一覧自体は表示される

認証不可で開けない画面がある場合はその旨を報告（CLAUDE.md ルールの例外条件）。

- [ ] **Step 3: リリース**

main に push（Vercel が自動デプロイ）:

```bash
git push origin main
```

デプロイ完了を `vercel ls` 等で確認し、本番URLで表示確認。

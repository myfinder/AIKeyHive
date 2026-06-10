const ANTHROPIC_API_BASE = "https://api.anthropic.com/v1";

function headers() {
  return {
    "x-api-key": process.env.ANTHROPIC_ADMIN_KEY || "",
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  };
}

export interface AnthropicApiKey {
  id: string;
  name: string;
  partial_key_hint: string;
  workspace_id: string | null;
  status: "active" | "inactive" | "archived";
}

export async function listOrgKeys(
  workspaceId?: string
): Promise<{ data: AnthropicApiKey[] }> {
  const params = new URLSearchParams();
  if (workspaceId) params.append("workspace_id", workspaceId);
  params.append("status", "active");
  params.append("limit", "1000");
  const res = await fetch(
    `${ANTHROPIC_API_BASE}/organizations/api_keys?${params}`,
    { headers: headers() }
  );
  if (!res.ok)
    throw new Error(`Anthropic listOrgKeys failed: ${res.status}`);
  return res.json();
}

export async function archiveKey(keyId: string): Promise<void> {
  // Anthropic has no delete — set to "inactive"
  const res = await fetch(
    `${ANTHROPIC_API_BASE}/organizations/api_keys/${keyId}`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ status: "inactive" }),
    }
  );
  if (!res.ok)
    throw new Error(`Anthropic archiveKey failed: ${res.status}`);
}

export async function findKeyByHint(
  partialHint: string,
  workspaceId?: string
): Promise<AnthropicApiKey | null> {
  const params = new URLSearchParams();
  if (workspaceId) params.append("workspace_id", workspaceId);
  params.append("limit", "1000");
  const res = await fetch(
    `${ANTHROPIC_API_BASE}/organizations/api_keys?${params}`,
    { headers: headers() }
  );
  if (!res.ok) return null;
  const data = await res.json();
  // Match by partial_key_hint ending (last 4 chars are unique enough)
  return (
    data.data?.find(
      (k: AnthropicApiKey) => k.partial_key_hint.endsWith(partialHint)
    ) || null
  );
}

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

export async function syncPoolFromAdmin() {
  const { data: keys } = await listOrgKeys(
    process.env.ANTHROPIC_WORKSPACE_ID
  );
  return keys.filter((k) => k.status === "active");
}

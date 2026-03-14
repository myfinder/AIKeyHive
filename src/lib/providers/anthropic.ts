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

export async function syncPoolFromAdmin() {
  const { data: keys } = await listOrgKeys(
    process.env.ANTHROPIC_WORKSPACE_ID
  );
  return keys.filter((k) => k.status === "active");
}

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
  hint: string;
  workspace_id: string | null;
  status: "active" | "disabled" | "archived";
}

export async function listOrgKeys(): Promise<{ data: AnthropicApiKey[] }> {
  const res = await fetch(
    `${ANTHROPIC_API_BASE}/organizations/${process.env.ANTHROPIC_ORG_ID}/api_keys`,
    { headers: headers() }
  );
  if (!res.ok)
    throw new Error(`Anthropic listOrgKeys failed: ${res.status}`);
  return res.json();
}

export async function disableKey(keyId: string): Promise<void> {
  const res = await fetch(
    `${ANTHROPIC_API_BASE}/organizations/${process.env.ANTHROPIC_ORG_ID}/api_keys/${keyId}`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ status: "disabled" }),
    }
  );
  if (!res.ok)
    throw new Error(`Anthropic disableKey failed: ${res.status}`);
}

export async function syncPoolFromAdmin() {
  const { data: keys } = await listOrgKeys();
  return keys.filter((k) => k.status === "active");
}

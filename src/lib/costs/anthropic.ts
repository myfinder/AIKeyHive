const ANTHROPIC_API_BASE = "https://api.anthropic.com/v1";

function headers() {
  return {
    "x-api-key": process.env.ANTHROPIC_ADMIN_KEY || "",
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  };
}

export interface AnthropicCostEntry {
  date: string;
  workspaceId: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export async function fetchCosts(
  startDate: string,
  endDate: string
): Promise<AnthropicCostEntry[]> {
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    group_by: "workspace,model",
  });

  const res = await fetch(
    `${ANTHROPIC_API_BASE}/organizations/${process.env.ANTHROPIC_ORG_ID}/cost_report?${params}`,
    { headers: headers() }
  );
  if (!res.ok)
    throw new Error(`Anthropic fetchCosts failed: ${res.status}`);

  const data = await res.json();
  const entries: AnthropicCostEntry[] = [];

  for (const item of data.data || []) {
    entries.push({
      date: item.date || startDate,
      workspaceId: item.workspace_id || null,
      model: item.model || null,
      inputTokens: item.input_tokens || 0,
      outputTokens: item.output_tokens || 0,
      costUsd: item.cost_usd || 0,
    });
  }

  return entries;
}

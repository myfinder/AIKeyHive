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

interface CostResult {
  currency: string;
  amount: string;
  workspace_id: string | null;
  model: string | null;
  token_type: string | null;
  description: string | null;
}

interface CostBucket {
  starting_at: string;
  ending_at: string;
  results: CostResult[];
}

export async function fetchCosts(
  startDate: string,
  endDate: string
): Promise<AnthropicCostEntry[]> {
  const params = new URLSearchParams();
  params.append("starting_at", `${startDate}T00:00:00Z`);
  params.append("ending_at", `${endDate}T00:00:00Z`);
  params.append("bucket_width", "1d");
  params.append("group_by[]", "workspace_id");
  params.append("group_by[]", "description");

  const res = await fetch(
    `${ANTHROPIC_API_BASE}/organizations/cost_report?${params}`,
    { headers: headers() }
  );
  if (!res.ok)
    throw new Error(`Anthropic fetchCosts failed: ${res.status}`);

  const data = (await res.json()) as { data: CostBucket[] };
  // Aggregate by date + workspace + model
  const aggregated = new Map<string, AnthropicCostEntry>();

  for (const bucket of data.data) {
    const date = bucket.starting_at.split("T")[0];
    for (const item of bucket.results) {
      const key = `${date}|${item.workspace_id || ""}|${item.model || "other"}`;
      const existing = aggregated.get(key);
      const amount = parseFloat(item.amount);

      if (existing) {
        existing.costUsd += amount;
        if (item.token_type?.includes("input")) {
          existing.inputTokens += amount;
        } else if (item.token_type?.includes("output")) {
          existing.outputTokens += amount;
        }
      } else {
        aggregated.set(key, {
          date,
          workspaceId: item.workspace_id || null,
          model: item.model || item.description || null,
          inputTokens: item.token_type?.includes("input") ? amount : 0,
          outputTokens: item.token_type?.includes("output") ? amount : 0,
          costUsd: amount,
        });
      }
    }
  }

  return Array.from(aggregated.values());
}

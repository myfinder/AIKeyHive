const OPENAI_API_BASE = "https://api.openai.com/v1";

function headers() {
  return {
    Authorization: `Bearer ${process.env.OPENAI_ADMIN_KEY}`,
    "Content-Type": "application/json",
    "OpenAI-Organization": process.env.OPENAI_ORG_ID || "",
  };
}

interface CostBucket {
  object: string;
  amount: { value: number; currency: string };
  line_item: string | null;
  project_id: string | null;
}

interface CostResult {
  object: string;
  amount: { value: number; currency: string };
  start_time: number;
  end_time: number;
  results: CostBucket[] | null;
}

export interface OpenAICostEntry {
  date: string;
  projectId: string | null;
  model: string | null;
  costUsd: number;
}

export async function fetchCosts(
  startDate: string,
  endDate: string
): Promise<OpenAICostEntry[]> {
  const startTime = Math.floor(new Date(startDate).getTime() / 1000);
  const endTime = Math.floor(new Date(endDate).getTime() / 1000);

  const params = new URLSearchParams({
    start_time: startTime.toString(),
    end_time: endTime.toString(),
    bucket_width: "1d",
    group_by: '["project_id","line_item"]',
  });

  const res = await fetch(
    `${OPENAI_API_BASE}/organization/costs?${params}`,
    { headers: headers() }
  );
  if (!res.ok) throw new Error(`OpenAI fetchCosts failed: ${res.status}`);

  const data = (await res.json()) as { data: CostResult[] };
  const entries: OpenAICostEntry[] = [];

  for (const bucket of data.data) {
    const date = new Date(bucket.start_time * 1000)
      .toISOString()
      .split("T")[0];
    if (bucket.results) {
      for (const item of bucket.results) {
        entries.push({
          date,
          projectId: item.project_id,
          model: item.line_item,
          costUsd: item.amount.value,
        });
      }
    }
  }

  return entries;
}

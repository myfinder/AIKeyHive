export interface GeminiCostEntry {
  date: string;
  model: string | null;
  costUsd: number;
}

export async function fetchCosts(
  startDate: string,
  endDate: string
): Promise<GeminiCostEntry[]> {
  const billingTable = process.env.BIGQUERY_BILLING_TABLE;
  if (!billingTable) {
    return [];
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(billingTable)) {
    throw new Error("Invalid BIGQUERY_BILLING_TABLE format");
  }

  const { BigQuery } = await import("@google-cloud/bigquery");

  const credentialsJson = process.env.GOOGLE_CREDENTIALS_JSON;
  const bigquery = new BigQuery(
    credentialsJson ? { credentials: JSON.parse(credentialsJson) } : {}
  );

  const query = `
    SELECT
      FORMAT_DATE('%Y-%m-%d', usage_start_time) as date,
      sku.description as model,
      SUM(cost) as cost_usd
    FROM \`${billingTable}\`
    WHERE
      service.description LIKE '%Vertex AI%'
      AND FORMAT_DATE('%Y-%m-%d', usage_start_time) >= @startDate
      AND FORMAT_DATE('%Y-%m-%d', usage_start_time) <= @endDate
    GROUP BY date, model
    ORDER BY date
  `;

  const [rows] = await bigquery.query({
    query,
    params: { startDate, endDate },
  });

  return (rows as Array<{ date: string; model: string | null; cost_usd: number }>).map(
    (row) => ({
      date: row.date,
      model: row.model,
      costUsd: Number(row.cost_usd),
    })
  );
}

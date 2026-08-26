import { db } from "@/db";
import { modelPrices } from "@/db/schema";

type PriceSeedDatabase = Pick<typeof db, "insert">;

// Standard text-token prices for OpenAI Responses/Chat models.
// Checked against:
// - https://developers.openai.com/api/docs/pricing
// - https://developers.openai.com/api/docs/models/all
// The current schema intentionally does not encode long-context tiers,
// Batch/Flex/Priority pricing, or non-text modalities.
export const defaultModelPrices = [
  {
    provider: "openai",
    model: "chat-latest",
    inputUsdPer1m: 5,
    cachedInputUsdPer1m: 0.5,
    outputUsdPer1m: 30,
    active: 1,
  },
  {
    provider: "openai",
    model: "gpt-4.1",
    inputUsdPer1m: 2,
    cachedInputUsdPer1m: 0.5,
    outputUsdPer1m: 8,
    active: 1,
  },
  {
    provider: "openai",
    model: "gpt-4.1-mini",
    inputUsdPer1m: 0.4,
    cachedInputUsdPer1m: 0.1,
    outputUsdPer1m: 1.6,
    active: 1,
  },
  {
    provider: "openai",
    model: "gpt-4o-mini",
    inputUsdPer1m: 0.15,
    cachedInputUsdPer1m: 0.075,
    outputUsdPer1m: 0.6,
    active: 1,
  },
  {
    provider: "openai",
    model: "gpt-5",
    inputUsdPer1m: 1.25,
    cachedInputUsdPer1m: 0.125,
    outputUsdPer1m: 10,
    active: 1,
  },
  {
    provider: "openai",
    model: "gpt-5-mini",
    inputUsdPer1m: 0.25,
    cachedInputUsdPer1m: 0.025,
    outputUsdPer1m: 2,
    active: 1,
  },
  {
    provider: "openai",
    model: "gpt-5-nano",
    inputUsdPer1m: 0.05,
    cachedInputUsdPer1m: 0.005,
    outputUsdPer1m: 0.4,
    active: 1,
  },
  {
    provider: "openai",
    model: "gpt-5-pro",
    inputUsdPer1m: 15,
    cachedInputUsdPer1m: null,
    outputUsdPer1m: 120,
    active: 1,
  },
  {
    provider: "openai",
    model: "gpt-5.1",
    inputUsdPer1m: 1.25,
    cachedInputUsdPer1m: 0.125,
    outputUsdPer1m: 10,
    active: 1,
  },
  {
    provider: "openai",
    model: "gpt-5.2",
    inputUsdPer1m: 1.75,
    cachedInputUsdPer1m: 0.175,
    outputUsdPer1m: 14,
    active: 1,
  },
  {
    provider: "openai",
    model: "gpt-5.2-pro",
    inputUsdPer1m: 21,
    cachedInputUsdPer1m: null,
    outputUsdPer1m: 168,
    active: 1,
  },
  {
    provider: "openai",
    model: "gpt-5.3-codex",
    inputUsdPer1m: 1.75,
    cachedInputUsdPer1m: 0.175,
    outputUsdPer1m: 14,
    active: 1,
  },
  {
    provider: "openai",
    model: "gpt-5.4",
    inputUsdPer1m: 2.5,
    cachedInputUsdPer1m: 0.25,
    outputUsdPer1m: 15,
    active: 1,
  },
  {
    provider: "openai",
    model: "gpt-5.4-mini",
    inputUsdPer1m: 0.75,
    cachedInputUsdPer1m: 0.075,
    outputUsdPer1m: 4.5,
    active: 1,
  },
  {
    provider: "openai",
    model: "gpt-5.4-nano",
    inputUsdPer1m: 0.2,
    cachedInputUsdPer1m: 0.02,
    outputUsdPer1m: 1.25,
    active: 1,
  },
  {
    provider: "openai",
    model: "gpt-5.4-pro",
    inputUsdPer1m: 30,
    cachedInputUsdPer1m: null,
    outputUsdPer1m: 180,
    active: 1,
  },
  {
    provider: "openai",
    model: "gpt-5.5",
    inputUsdPer1m: 5,
    cachedInputUsdPer1m: 0.5,
    outputUsdPer1m: 30,
    active: 1,
  },
  {
    provider: "openai",
    model: "gpt-5.5-pro",
    inputUsdPer1m: 30,
    cachedInputUsdPer1m: null,
    outputUsdPer1m: 180,
    active: 1,
  },
  {
    provider: "openai",
    model: "o3",
    inputUsdPer1m: 2,
    cachedInputUsdPer1m: 0.5,
    outputUsdPer1m: 8,
    active: 1,
  },
  {
    provider: "openai",
    model: "o3-pro",
    inputUsdPer1m: 20,
    cachedInputUsdPer1m: null,
    outputUsdPer1m: 80,
    active: 1,
  },
] as const;

export async function seedDefaultModelPrices(database: PriceSeedDatabase = db) {
  const inserted = [];

  for (const price of defaultModelPrices) {
    const row = await database
      .insert(modelPrices)
      .values(price)
      .onConflictDoNothing()
      .returning()
      .get();

    if (row) {
      inserted.push(row);
    }
  }

  return inserted;
}

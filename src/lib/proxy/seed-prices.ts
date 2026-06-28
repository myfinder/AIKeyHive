import { db } from "@/db";
import { modelPrices } from "@/db/schema";

type PriceSeedDatabase = Pick<typeof db, "insert">;

export const defaultModelPrices = [
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

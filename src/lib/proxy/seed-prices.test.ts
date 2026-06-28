import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/__tests__/db-helper";
import { modelPrices } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  defaultModelPrices,
  seedDefaultModelPrices,
} from "@/lib/proxy/seed-prices";

const testDbInstance = createTestDb();

describe("seedDefaultModelPrices", () => {
  beforeEach(() => {
    testDbInstance.sqlite.exec("DELETE FROM model_prices");
  });

  it("inserts the default OpenAI model prices into an empty database", async () => {
    await seedDefaultModelPrices(testDbInstance.db);

    const rows = testDbInstance.db
      .select()
      .from(modelPrices)
      .orderBy(modelPrices.model)
      .all();

    expect(rows).toHaveLength(2);
    const expectedPrices = [...defaultModelPrices].sort((a, b) =>
      a.model.localeCompare(b.model)
    );
    expect(rows).toEqual(
      expectedPrices.map((price) =>
        expect.objectContaining({
          provider: price.provider,
          model: price.model,
          inputUsdPer1m: price.inputUsdPer1m,
          cachedInputUsdPer1m: price.cachedInputUsdPer1m,
          outputUsdPer1m: price.outputUsdPer1m,
          active: 1,
        })
      )
    );
  });

  it("does not duplicate or overwrite an existing active price", async () => {
    testDbInstance.db
      .insert(modelPrices)
      .values({
        id: "custom-active-mini",
        provider: "openai",
        model: "gpt-5-mini",
        inputUsdPer1m: 9,
        cachedInputUsdPer1m: 8,
        outputUsdPer1m: 7,
        active: 1,
      })
      .run();

    await seedDefaultModelPrices(testDbInstance.db);

    const miniRows = testDbInstance.db
      .select()
      .from(modelPrices)
      .where(eq(modelPrices.model, "gpt-5-mini"))
      .all();

    expect(miniRows).toHaveLength(1);
    expect(miniRows[0]).toMatchObject({
      id: "custom-active-mini",
      inputUsdPer1m: 9,
      cachedInputUsdPer1m: 8,
      outputUsdPer1m: 7,
      active: 1,
    });
  });

  it("stays idempotent across repeated and parallel seed calls", async () => {
    await Promise.all([
      seedDefaultModelPrices(testDbInstance.db),
      seedDefaultModelPrices(testDbInstance.db),
      seedDefaultModelPrices(testDbInstance.db),
    ]);
    await seedDefaultModelPrices(testDbInstance.db);

    const rows = testDbInstance.db.select().from(modelPrices).all();

    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.active === 1)).toHaveLength(2);
    expect(rows.map((row) => `${row.provider}:${row.model}`).sort()).toEqual([
      "openai:gpt-5-mini",
      "openai:gpt-5-nano",
    ]);
  });

  it("inserts an active default when only inactive rows exist for the model", async () => {
    testDbInstance.db
      .insert(modelPrices)
      .values({
        id: "inactive-nano",
        provider: "openai",
        model: "gpt-5-nano",
        inputUsdPer1m: 99,
        cachedInputUsdPer1m: 88,
        outputUsdPer1m: 77,
        active: 0,
      })
      .run();

    await seedDefaultModelPrices(testDbInstance.db);

    const nanoRows = testDbInstance.db
      .select()
      .from(modelPrices)
      .where(eq(modelPrices.model, "gpt-5-nano"))
      .orderBy(modelPrices.active)
      .all();

    expect(nanoRows).toHaveLength(2);
    expect(nanoRows[0]).toMatchObject({
      id: "inactive-nano",
      inputUsdPer1m: 99,
      cachedInputUsdPer1m: 88,
      outputUsdPer1m: 77,
      active: 0,
    });
    expect(nanoRows[1]).toMatchObject({
      provider: "openai",
      model: "gpt-5-nano",
      inputUsdPer1m: 0.05,
      cachedInputUsdPer1m: 0.005,
      outputUsdPer1m: 0.4,
      active: 1,
    });
  });
});

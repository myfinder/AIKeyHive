import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedUser } from "@/__tests__/db-helper";
import {
  modelPrices,
  proxyBudgetReservations,
  proxyKeyPolicies,
  proxyKeys,
  proxyUsageEvents,
} from "@/db/schema";

const testDbInstance = createTestDb();

const notNullColumns = {
  proxy_keys: ["key_hint"],
  proxy_key_policies: [
    "allowed_models_json",
    "hourly_limit_usd",
    "daily_limit_usd",
    "monthly_limit_usd",
    "max_request_usd",
    "max_output_tokens",
  ],
  proxy_usage_events: ["estimated_cost_usd", "reserved_cost_usd"],
  proxy_budget_reservations: [
    "proxy_key_id",
    "hour_window",
    "day_window",
    "month_window",
    "reserved_micro_usd",
    "released",
    "reconciled",
  ],
};

describe("proxy mode schema", () => {
  beforeEach(() => {
    testDbInstance.sqlite.exec("DELETE FROM proxy_usage_events");
    testDbInstance.sqlite.exec("DELETE FROM proxy_budget_reservations");
    testDbInstance.sqlite.exec("DELETE FROM proxy_key_policies");
    testDbInstance.sqlite.exec("DELETE FROM model_prices");
    testDbInstance.sqlite.exec("DELETE FROM proxy_keys");
    testDbInstance.sqlite.exec("DELETE FROM users");
  });

  it("stores proxy keys, policies, model prices, and usage events", () => {
    const user = seedUser(testDbInstance.db, {
      id: "user-1",
      oidcSub: "oidc-sub-1",
      email: "user1@test.com",
    });

    const proxyKey = testDbInstance.db
      .insert(proxyKeys)
      .values({
        id: "proxy-key-1",
        userId: user.id,
        name: "CI proxy key",
        keyHash: "sha256:test-proxy-key-hash",
        keyHint: "aikh_...abcd",
        upstreamProjectId: "proj_123",
        upstreamProviderKeyId: "sa_123",
        upstreamKeyValue: "encrypted-upstream-key",
        upstreamKeyHint: "sk-...abcd",
      })
      .returning()
      .get();

    expect(proxyKey.status).toBe("active");
    expect(proxyKey.upstreamProjectId).toBe("proj_123");
    expect(proxyKey.upstreamProviderKeyId).toBe("sa_123");
    expect(proxyKey.upstreamKeyValue).toBe("encrypted-upstream-key");
    expect(proxyKey.upstreamKeyHint).toBe("sk-...abcd");
    expect(proxyKey.createdAt).toEqual(expect.any(String));

    const policy = testDbInstance.db
      .insert(proxyKeyPolicies)
      .values({
        id: "policy-1",
        proxyKeyId: proxyKey.id,
        provider: "openai",
        allowedModelsJson: JSON.stringify(["gpt-5-mini"]),
        hourlyLimitUsd: 1.5,
        dailyLimitUsd: 10,
        monthlyLimitUsd: 100,
        maxRequestUsd: 0.25,
        maxOutputTokens: 2048,
      })
      .returning()
      .get();

    expect(policy.maxConcurrency).toBe(1);
    expect(policy.allowTools).toBe(0);
    expect(policy.createdAt).toEqual(expect.any(String));
    expect(policy.updatedAt).toEqual(expect.any(String));

    const price = testDbInstance.db
      .insert(modelPrices)
      .values({
        id: "price-1",
        provider: "openai",
        model: "gpt-5-mini",
        inputUsdPer1m: 0.25,
        outputUsdPer1m: 2,
      })
      .returning()
      .get();

    expect(price.cachedInputUsdPer1m).toBeNull();
    expect(price.active).toBe(1);
    expect(price.createdAt).toEqual(expect.any(String));

    testDbInstance.db
      .insert(proxyUsageEvents)
      .values({
        id: "usage-1",
        proxyKeyId: proxyKey.id,
        userId: user.id,
        provider: "openai",
        endpoint: "responses",
        model: "gpt-5-mini",
        status: "succeeded",
        requestId: "proxy-request-1",
        providerRequestId: "resp_123",
        estimatedCostUsd: 0.01,
        reservedCostUsd: 0.02,
        actualCostUsd: 0.012,
        inputTokens: 1000,
        outputTokens: 500,
        rawUsageJson: JSON.stringify({
          input_tokens: 1000,
          output_tokens: 500,
        }),
        completedAt: "2026-06-27T00:00:00Z",
      })
      .run();

    const storedUsage = testDbInstance.db
      .select()
      .from(proxyUsageEvents)
      .where(eq(proxyUsageEvents.requestId, "proxy-request-1"))
      .get();

    expect(storedUsage).toMatchObject({
      proxyKeyId: "proxy-key-1",
      userId: "user-1",
      provider: "openai",
      endpoint: "responses",
      model: "gpt-5-mini",
      status: "succeeded",
      actualCostUsd: 0.012,
      inputTokens: 1000,
      outputTokens: 500,
    });
    expect(storedUsage?.createdAt).toEqual(expect.any(String));

    const reservation = testDbInstance.db
      .insert(proxyBudgetReservations)
      .values({
        id: "reservation-1",
        proxyKeyId: proxyKey.id,
        hourWindow: "2026062801",
        dayWindow: "20260628",
        monthWindow: "202606",
        reservedMicroUsd: 2500,
      })
      .returning()
      .get();

    expect(reservation).toMatchObject({
      id: "reservation-1",
      proxyKeyId: "proxy-key-1",
      hourWindow: "2026062801",
      dayWindow: "20260628",
      monthWindow: "202606",
      reservedMicroUsd: 2500,
      actualMicroUsd: null,
      released: 0,
      reconciled: 0,
    });
    expect(reservation.createdAt).toEqual(expect.any(String));
  });

  it("marks required proxy mode schema fields as not null", () => {
    expect(proxyKeys.keyHint.notNull).toBe(true);
    expect(proxyKeys.upstreamKeyValue.notNull).toBe(false);
    expect(proxyKeyPolicies.allowedModelsJson.notNull).toBe(true);
    expect(proxyKeyPolicies.hourlyLimitUsd.notNull).toBe(true);
    expect(proxyKeyPolicies.dailyLimitUsd.notNull).toBe(true);
    expect(proxyKeyPolicies.monthlyLimitUsd.notNull).toBe(true);
    expect(proxyKeyPolicies.maxRequestUsd.notNull).toBe(true);
    expect(proxyKeyPolicies.maxOutputTokens.notNull).toBe(true);
    expect(proxyUsageEvents.estimatedCostUsd.notNull).toBe(true);
    expect(proxyUsageEvents.reservedCostUsd.notNull).toBe(true);
    expect(proxyBudgetReservations.proxyKeyId.notNull).toBe(true);
    expect(proxyBudgetReservations.reservedMicroUsd.notNull).toBe(true);

    for (const [table, columns] of Object.entries(notNullColumns)) {
      const columnInfo = testDbInstance.sqlite
        .prepare(`PRAGMA table_info(${table})`)
        .all() as Array<{ name: string; notnull: number }>;

      for (const column of columns) {
        expect(
          columnInfo.find((info) => info.name === column)?.notnull
        ).toBe(1);
      }
    }
  });

  it("prevents duplicate active model prices for the same provider and model", () => {
    testDbInstance.db
      .insert(modelPrices)
      .values({
        provider: "openai",
        model: "gpt-5-mini",
        inputUsdPer1m: 0.25,
        outputUsdPer1m: 2,
        active: 1,
      })
      .run();

    expect(() =>
      testDbInstance.db
        .insert(modelPrices)
        .values({
          provider: "openai",
          model: "gpt-5-mini",
          inputUsdPer1m: 0.5,
          outputUsdPer1m: 4,
          active: 1,
        })
        .run()
    ).toThrow();

    expect(() =>
      testDbInstance.db
        .insert(modelPrices)
        .values({
          provider: "openai",
          model: "gpt-5-mini",
          inputUsdPer1m: 0.5,
          outputUsdPer1m: 4,
          active: 0,
        })
        .run()
    ).not.toThrow();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedUser } from "@/__tests__/db-helper";
import { proxyKeys, proxyUsageEvents } from "@/db/schema";

const testDbInstance = createTestDb();
vi.mock("@/db", () => ({ db: testDbInstance.db }));

const {
  createReservedUsageEvent,
  markUsageFailed,
  markUsageSucceeded,
  markUsageUnknown,
} = await import("@/lib/proxy/usage");

const NOW = new Date("2026-06-27T10:11:12.000Z");
const COMPLETED_AT = new Date("2026-06-27T10:12:13.000Z");

describe("proxy usage ledger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    testDbInstance.sqlite.exec("DELETE FROM proxy_usage_events");
    testDbInstance.sqlite.exec("DELETE FROM proxy_keys");
    testDbInstance.sqlite.exec("DELETE FROM users");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates reserved usage event", async () => {
    const { user, proxyKey } = seedProxyKey();

    const usageEventId = await createReservedUsageEvent({
      proxyKeyId: proxyKey.id,
      userId: user.id,
      provider: "openai",
      endpoint: "responses",
      model: "gpt-5-mini",
      estimatedCostUsd: 0.012,
      reservedCostUsd: 0.02,
      requestId: "proxy-request-1",
    });

    const event = getUsageEvent(usageEventId);
    expect(event).toMatchObject({
      id: usageEventId,
      proxyKeyId: proxyKey.id,
      userId: user.id,
      provider: "openai",
      endpoint: "responses",
      model: "gpt-5-mini",
      status: "reserved",
      requestId: "proxy-request-1",
      estimatedCostUsd: 0.012,
      reservedCostUsd: 0.02,
    });
    expect(event.actualCostUsd).toBeNull();
    expect(event.providerRequestId).toBeNull();
  });

  it("marks success with token usage and actual cost", async () => {
    seedReservedUsageEvent("usage-success");
    vi.setSystemTime(COMPLETED_AT);
    const rawUsage = {
      input_tokens: 123,
      output_tokens: 45,
      total_tokens: 168,
    };

    await markUsageSucceeded({
      usageEventId: "usage-success",
      actualCostUsd: 0.0042,
      inputTokens: 123,
      outputTokens: 45,
      rawUsage,
      providerRequestId: "resp_123",
      completedAt: COMPLETED_AT,
    });

    expect(getUsageEvent("usage-success")).toMatchObject({
      status: "succeeded",
      actualCostUsd: 0.0042,
      inputTokens: 123,
      outputTokens: 45,
      rawUsageJson: JSON.stringify(rawUsage),
      providerRequestId: "resp_123",
      completedAt: COMPLETED_AT.toISOString(),
    });
  });

  it("marks failure with provider error code", async () => {
    seedReservedUsageEvent("usage-failed");
    vi.setSystemTime(COMPLETED_AT);

    await markUsageFailed({
      usageEventId: "usage-failed",
      errorCode: "rate_limit_exceeded",
      providerRequestId: "req_provider_123",
      completedAt: COMPLETED_AT,
    });

    expect(getUsageEvent("usage-failed")).toMatchObject({
      status: "failed",
      errorCode: "rate_limit_exceeded",
      providerRequestId: "req_provider_123",
      completedAt: COMPLETED_AT.toISOString(),
    });
  });

  it("marks usage unknown when stream terminates without final usage", async () => {
    seedReservedUsageEvent("usage-unknown");
    vi.setSystemTime(COMPLETED_AT);

    await markUsageUnknown({
      usageEventId: "usage-unknown",
      providerRequestId: "resp_stream_123",
      completedAt: COMPLETED_AT,
    });

    expect(getUsageEvent("usage-unknown")).toMatchObject({
      status: "usage_unknown",
      providerRequestId: "resp_stream_123",
      completedAt: COMPLETED_AT.toISOString(),
    });
  });

  it("updates proxy_keys.last_used_at", async () => {
    const { user, proxyKey } = seedProxyKey({
      id: "proxy-key-last-used",
      lastUsedAt: "2026-06-01T00:00:00.000Z",
    });

    const usageEventId = await createReservedUsageEvent({
      proxyKeyId: proxyKey.id,
      userId: user.id,
      provider: "openai",
      endpoint: "chat_completions",
      model: "gpt-5-mini",
      estimatedCostUsd: 0.01,
      reservedCostUsd: 0.02,
      requestId: "proxy-request-last-used",
    });

    expect(getProxyKey(proxyKey.id).lastUsedAt).toBe(NOW.toISOString());

    vi.setSystemTime(COMPLETED_AT);
    await markUsageUnknown({
      usageEventId,
      completedAt: COMPLETED_AT,
    });

    expect(getProxyKey(proxyKey.id).lastUsedAt).toBe(COMPLETED_AT.toISOString());
  });

  it("uses completedAt for last_used_at when it differs from system time", async () => {
    const { proxyKey } = seedReservedUsageEvent("usage-completed-at-last-used");
    vi.setSystemTime(new Date("2026-06-27T10:30:00.000Z"));

    await markUsageFailed({
      usageEventId: "usage-completed-at-last-used",
      errorCode: "provider_timeout",
      completedAt: COMPLETED_AT,
    });

    expect(getProxyKey(proxyKey.id).lastUsedAt).toBe(COMPLETED_AT.toISOString());
  });

  it("does not overwrite a succeeded event with usage unknown", async () => {
    const { proxyKey } = seedReservedUsageEvent("usage-success-then-unknown");
    const rawUsage = {
      input_tokens: 10,
      output_tokens: 20,
      total_tokens: 30,
    };

    await markUsageSucceeded({
      usageEventId: "usage-success-then-unknown",
      actualCostUsd: 0.003,
      inputTokens: 10,
      outputTokens: 20,
      rawUsage,
      providerRequestId: "resp_success",
      completedAt: COMPLETED_AT,
    });
    const lastUsedAtAfterSuccess = getProxyKey(proxyKey.id).lastUsedAt;
    vi.setSystemTime(new Date("2026-06-27T10:30:00.000Z"));

    await markUsageUnknown({
      usageEventId: "usage-success-then-unknown",
      providerRequestId: "resp_unknown",
      completedAt: new Date("2026-06-27T10:31:00.000Z"),
    });

    expect(getUsageEvent("usage-success-then-unknown")).toMatchObject({
      status: "succeeded",
      actualCostUsd: 0.003,
      inputTokens: 10,
      outputTokens: 20,
      rawUsageJson: JSON.stringify(rawUsage),
      providerRequestId: "resp_success",
      completedAt: COMPLETED_AT.toISOString(),
    });
    expect(getProxyKey(proxyKey.id).lastUsedAt).toBe(lastUsedAtAfterSuccess);
  });

  it("does not overwrite a usage unknown event with success", async () => {
    const { proxyKey } = seedReservedUsageEvent("usage-unknown-then-success");

    await markUsageUnknown({
      usageEventId: "usage-unknown-then-success",
      providerRequestId: "resp_unknown",
      completedAt: COMPLETED_AT,
    });
    const lastUsedAtAfterUnknown = getProxyKey(proxyKey.id).lastUsedAt;
    vi.setSystemTime(new Date("2026-06-27T10:30:00.000Z"));

    await markUsageSucceeded({
      usageEventId: "usage-unknown-then-success",
      actualCostUsd: 0.003,
      inputTokens: 10,
      outputTokens: 20,
      rawUsage: { input_tokens: 10, output_tokens: 20 },
      providerRequestId: "resp_success",
      completedAt: new Date("2026-06-27T10:31:00.000Z"),
    });

    expect(getUsageEvent("usage-unknown-then-success")).toMatchObject({
      status: "usage_unknown",
      providerRequestId: "resp_unknown",
      completedAt: COMPLETED_AT.toISOString(),
    });
    expect(getUsageEvent("usage-unknown-then-success").actualCostUsd).toBeNull();
    expect(getUsageEvent("usage-unknown-then-success").rawUsageJson).toBeNull();
    expect(getProxyKey(proxyKey.id).lastUsedAt).toBe(lastUsedAtAfterUnknown);
  });

  it("does not throw when usage event does not exist", async () => {
    await expect(
      markUsageSucceeded({
        usageEventId: "missing-usage-event",
        actualCostUsd: 0.001,
        inputTokens: 10,
        outputTokens: 20,
        rawUsage: { input_tokens: 10, output_tokens: 20 },
      })
    ).resolves.toBeUndefined();
    await expect(
      markUsageFailed({
        usageEventId: "missing-usage-event",
        errorCode: "server_error",
      })
    ).resolves.toBeUndefined();
    await expect(
      markUsageUnknown({ usageEventId: "missing-usage-event" })
    ).resolves.toBeUndefined();
  });

  it("does not serialize raw usage when the usage event does not exist", async () => {
    const rawUsage: Record<string, unknown> = {};
    rawUsage.self = rawUsage;

    await expect(
      markUsageSucceeded({
        usageEventId: "missing-usage-event",
        actualCostUsd: 0.001,
        inputTokens: 10,
        outputTokens: 20,
        rawUsage,
      })
    ).resolves.toBeUndefined();
  });

  it("marks success with null raw usage JSON when raw usage cannot serialize", async () => {
    seedReservedUsageEvent("usage-unserializable-raw");

    await markUsageSucceeded({
      usageEventId: "usage-unserializable-raw",
      actualCostUsd: 0.001,
      inputTokens: 10,
      outputTokens: 20,
      rawUsage: { total_tokens: 30n },
      completedAt: COMPLETED_AT,
    });

    expect(getUsageEvent("usage-unserializable-raw")).toMatchObject({
      status: "succeeded",
      actualCostUsd: 0.001,
      inputTokens: 10,
      outputTokens: 20,
      rawUsageJson: null,
      completedAt: COMPLETED_AT.toISOString(),
    });
  });
});

function seedProxyKey(input: { id?: string; lastUsedAt?: string | null } = {}) {
  const user = seedUser(testDbInstance.db, {
    id: "user-1",
    oidcSub: "oidc-sub-1",
    email: "user1@test.com",
  });

  const proxyKey = testDbInstance.db
    .insert(proxyKeys)
    .values({
      id: input.id ?? "proxy-key-1",
      userId: user.id,
      name: "Proxy key",
      keyHash: `sha256:${input.id ?? "proxy-key-1"}`,
      keyHint: "akp_...1234",
      lastUsedAt: input.lastUsedAt,
    })
    .returning()
    .get();

  return { user, proxyKey };
}

function seedReservedUsageEvent(id: string) {
  const { user, proxyKey } = seedProxyKey();

  testDbInstance.db
    .insert(proxyUsageEvents)
    .values({
      id,
      proxyKeyId: proxyKey.id,
      userId: user.id,
      provider: "openai",
      endpoint: "responses",
      model: "gpt-5-mini",
      status: "reserved",
      requestId: `request-${id}`,
      estimatedCostUsd: 0.01,
      reservedCostUsd: 0.02,
    })
    .run();

  return { user, proxyKey };
}

function getUsageEvent(id: string) {
  const event = testDbInstance.db
    .select()
    .from(proxyUsageEvents)
    .where(eq(proxyUsageEvents.id, id))
    .get();

  if (!event) {
    throw new Error(`Expected usage event ${id} to exist`);
  }

  return event;
}

function getProxyKey(id: string) {
  const proxyKey = testDbInstance.db
    .select()
    .from(proxyKeys)
    .where(eq(proxyKeys.id, id))
    .get();

  if (!proxyKey) {
    throw new Error(`Expected proxy key ${id} to exist`);
  }

  return proxyKey;
}

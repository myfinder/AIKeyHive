import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, seedUser } from "@/__tests__/db-helper";
import { modelPrices, proxyKeyPolicies, proxyKeys } from "@/db/schema";
import { hashProxyKeySecret } from "@/lib/proxy/key";
import {
  createReservedUsageEvent,
  markUsageFailed,
  markUsageSucceeded,
  markUsageUnknown,
} from "@/lib/proxy/usage";
import {
  refundReservation,
  releaseConcurrency,
  reserveBudget,
} from "@/lib/proxy/reservation";

const testDbInstance = createTestDb();
vi.mock("@/db", () => ({ db: testDbInstance.db }));

vi.mock("@/lib/proxy/reservation", () => ({
  reserveBudget: vi.fn(),
  releaseConcurrency: vi.fn(),
  refundReservation: vi.fn(),
}));

vi.mock("@/lib/proxy/usage", () => ({
  createReservedUsageEvent: vi.fn(),
  markUsageSucceeded: vi.fn(),
  markUsageFailed: vi.fn(),
  markUsageUnknown: vi.fn(),
}));

const { POST } = await import("@/app/api/proxy/openai/v1/responses/route");

const fetchMock = vi.fn();
const proxySecret = "akp_responses_test_secret";

function request(body: unknown, token = proxySecret) {
  return new Request("http://localhost/api/proxy/openai/v1/responses", {
    method: "POST",
    headers: token
      ? {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        }
      : { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function seedProxyKey(options: { status?: "active" | "revoked"; secret?: string } = {}) {
  const secret = options.secret ?? proxySecret;
  seedUser(testDbInstance.db, {
    id: "user-openai",
    oidcSub: "oidc-openai",
    email: "openai@example.com",
  });
  testDbInstance.db
    .insert(proxyKeys)
    .values({
      id: "proxy-key-openai",
      userId: "user-openai",
      name: "prod",
      keyHash: hashProxyKeySecret(secret),
      keyHint: "akp_...secret",
      status: options.status ?? "active",
    })
    .run();
  testDbInstance.db
    .insert(proxyKeyPolicies)
    .values({
      id: "policy-openai",
      proxyKeyId: "proxy-key-openai",
      provider: "openai",
      allowedModelsJson: JSON.stringify(["gpt-5-mini"]),
      hourlyLimitUsd: 1,
      dailyLimitUsd: 5,
      monthlyLimitUsd: 20,
      maxRequestUsd: 0.5,
      maxOutputTokens: 500,
      maxConcurrency: 2,
      allowTools: 0,
    })
    .run();
  testDbInstance.db
    .insert(modelPrices)
    .values({
      id: "price-gpt-5-mini",
      provider: "openai",
      model: "gpt-5-mini",
      inputUsdPer1m: 2,
      outputUsdPer1m: 10,
      active: 1,
    })
    .run();
}

describe("POST /api/proxy/openai/v1/responses", () => {
  beforeEach(() => {
    testDbInstance.sqlite.exec("DELETE FROM proxy_usage_events");
    testDbInstance.sqlite.exec("DELETE FROM model_prices");
    testDbInstance.sqlite.exec("DELETE FROM proxy_key_policies");
    testDbInstance.sqlite.exec("DELETE FROM proxy_keys");
    testDbInstance.sqlite.exec("DELETE FROM users");
    vi.clearAllMocks();
    process.env.OPENAI_PROXY_API_KEY = "sk-provider-key";
    delete process.env.OPENAI_ORG_ID;
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(reserveBudget).mockResolvedValue({
      ok: true,
      reservationId: "reservation-responses",
      reservedMicroUsd: 2500,
    });
    vi.mocked(createReservedUsageEvent).mockResolvedValue("usage-responses");
  });

  it("returns 401 when bearer proxy key is missing", async () => {
    const res = await POST(request({ model: "gpt-5-mini" }, ""));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toMatchObject({ code: "missing_proxy_key" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 401 for a valid-looking bearer proxy key that is not stored", async () => {
    const res = await POST(
      request(
        { model: "gpt-5-mini", input: "hello", max_output_tokens: 10 },
        "akp_not_in_db"
      )
    );
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toMatchObject({ code: "invalid_proxy_key" });
    expect(reserveBudget).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a revoked proxy key", async () => {
    seedProxyKey({ status: "revoked" });

    const res = await POST(
      request({ model: "gpt-5-mini", input: "hello", max_output_tokens: 10 })
    );
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toMatchObject({ code: "proxy_key_revoked" });
    expect(JSON.stringify(body)).not.toContain(hashProxyKeySecret(proxySecret));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reserves, forwards with provider auth, records success, and refunds actual usage", async () => {
    seedProxyKey();
    fetchMock.mockResolvedValue(
      Response.json(
        {
          id: "resp_123",
          model: "gpt-5-mini",
          output: [],
          usage: { input_tokens: 100, output_tokens: 20 },
        },
        { status: 200 }
      )
    );

    const res = await POST(
      request({ model: "gpt-5-mini", input: "hello", max_output_tokens: 50 })
    );
    const body = await res.json();
    const [upstreamUrl, upstreamInit] = fetchMock.mock.calls[0];
    const upstreamHeaders = upstreamInit.headers as Headers;

    expect(res.status).toBe(200);
    expect(body.id).toBe("resp_123");
    expect(upstreamUrl).toBe("https://api.openai.com/v1/responses");
    expect(upstreamHeaders.get("Authorization")).toBe("Bearer sk-provider-key");
    expect(JSON.stringify(Object.fromEntries(upstreamHeaders))).not.toContain("akp_");
    expect(await new Response(upstreamInit.body).json()).toMatchObject({
      model: "gpt-5-mini",
      input: "hello",
      max_output_tokens: 50,
    });
    expect(reserveBudget).toHaveBeenCalledWith(
      expect.objectContaining({
        proxyKeyId: "proxy-key-openai",
        hourlyLimitUsd: 1,
        dailyLimitUsd: 5,
        monthlyLimitUsd: 20,
        maxConcurrency: 2,
      })
    );
    expect(createReservedUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        proxyKeyId: "proxy-key-openai",
        userId: "user-openai",
        provider: "openai",
        endpoint: "responses",
        model: "gpt-5-mini",
        reservedCostUsd: 0.0025,
        requestId: "reservation-responses",
      })
    );
    expect(markUsageSucceeded).toHaveBeenCalledWith({
      usageEventId: "usage-responses",
      actualCostUsd: 0.0004,
      inputTokens: 100,
      outputTokens: 20,
      rawUsage: { input_tokens: 100, output_tokens: 20 },
      providerRequestId: "resp_123",
    });
    expect(releaseConcurrency).toHaveBeenCalledWith({
      reservationId: "reservation-responses",
      proxyKeyId: "proxy-key-openai",
    });
    expect(refundReservation).toHaveBeenCalledWith({
      reservationId: "reservation-responses",
      proxyKeyId: "proxy-key-openai",
      actualCostUsd: 0.0004,
      reservedMicroUsd: 2500,
    });
  });

  it("filters upstream response headers while preserving safe OpenAI headers", async () => {
    seedProxyKey();
    fetchMock.mockResolvedValue(
      Response.json(
        {
          id: "resp_headers",
          model: "gpt-5-mini",
          output: [],
          usage: { input_tokens: 100, output_tokens: 20 },
        },
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "openai-request-id": "req_openai_headers",
            "set-cookie": "provider_session=secret",
            "x-provider-secret": "do-not-forward",
          },
        }
      )
    );

    const res = await POST(
      request({ model: "gpt-5-mini", input: "hello", max_output_tokens: 50 })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe("resp_headers");
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("openai-request-id")).toBe("req_openai_headers");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("x-provider-secret")).toBeNull();
  });

  it("returns policy violations without calling upstream fetch", async () => {
    seedProxyKey();

    const res = await POST(
      request({ model: "gpt-5", input: "hello", max_output_tokens: 10 })
    );
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toMatchObject({ code: "model_not_allowed" });
    expect(reserveBudget).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 429 when budget reservation is rejected without calling upstream fetch", async () => {
    seedProxyKey();
    vi.mocked(reserveBudget).mockResolvedValue({
      ok: false,
      status: 429,
      code: "daily_budget_exceeded",
      message: "Daily proxy budget would be exceeded.",
    });

    const res = await POST(
      request({ model: "gpt-5-mini", input: "hello", max_output_tokens: 10 })
    );
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body.error).toMatchObject({ code: "daily_budget_exceeded" });
    expect(createReservedUsageEvent).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks failed and returns the upstream response for non-2xx OpenAI responses", async () => {
    seedProxyKey();
    fetchMock.mockResolvedValue(
      Response.json(
        { error: { code: "rate_limit_exceeded", message: "slow down" } },
        { status: 429 }
      )
    );

    const res = await POST(
      request({ model: "gpt-5-mini", input: "hello", max_output_tokens: 10 })
    );
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body).toEqual({
      error: { code: "rate_limit_exceeded", message: "slow down" },
    });
    expect(markUsageFailed).toHaveBeenCalledWith({
      usageEventId: "usage-responses",
      errorCode: "rate_limit_exceeded",
    });
    expect(releaseConcurrency).toHaveBeenCalledWith({
      reservationId: "reservation-responses",
      proxyKeyId: "proxy-key-openai",
    });
    expect(refundReservation).toHaveBeenCalledWith({
      reservationId: "reservation-responses",
      proxyKeyId: "proxy-key-openai",
      actualCostUsd: 0,
      reservedMicroUsd: 2500,
    });
  });

  it("returns upstream error and cleans up when recording failure fails", async () => {
    seedProxyKey();
    vi.mocked(markUsageFailed).mockRejectedValue(new Error("db unavailable"));
    fetchMock.mockResolvedValue(
      Response.json(
        { error: { code: "rate_limit_exceeded", message: "slow down" } },
        { status: 429 }
      )
    );

    const res = await POST(
      request({ model: "gpt-5-mini", input: "hello", max_output_tokens: 10 })
    );
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body).toEqual({
      error: { code: "rate_limit_exceeded", message: "slow down" },
    });
    expect(releaseConcurrency).toHaveBeenCalledWith({
      reservationId: "reservation-responses",
      proxyKeyId: "proxy-key-openai",
    });
    expect(refundReservation).toHaveBeenCalledWith({
      reservationId: "reservation-responses",
      proxyKeyId: "proxy-key-openai",
      actualCostUsd: 0,
      reservedMicroUsd: 2500,
    });
  });

  it("marks usage unknown and returns the upstream response when usage is missing", async () => {
    seedProxyKey();
    fetchMock.mockResolvedValue(
      Response.json({ id: "resp_missing_usage", model: "gpt-5-mini" }, { status: 200 })
    );

    const res = await POST(
      request({ model: "gpt-5-mini", input: "hello", max_output_tokens: 10 })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ id: "resp_missing_usage", model: "gpt-5-mini" });
    expect(markUsageUnknown).toHaveBeenCalledWith({
      usageEventId: "usage-responses",
      providerRequestId: "resp_missing_usage",
    });
    expect(refundReservation).toHaveBeenCalledWith({
      reservationId: "reservation-responses",
      proxyKeyId: "proxy-key-openai",
      actualCostUsd: 0,
      reservedMicroUsd: 2500,
    });
  });

  it("returns upstream success and cleans up when recording unknown usage fails", async () => {
    seedProxyKey();
    vi.mocked(markUsageUnknown).mockRejectedValue(new Error("db unavailable"));
    fetchMock.mockResolvedValue(
      Response.json({ id: "resp_missing_usage", model: "gpt-5-mini" }, { status: 200 })
    );

    const res = await POST(
      request({ model: "gpt-5-mini", input: "hello", max_output_tokens: 10 })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ id: "resp_missing_usage", model: "gpt-5-mini" });
    expect(releaseConcurrency).toHaveBeenCalledWith({
      reservationId: "reservation-responses",
      proxyKeyId: "proxy-key-openai",
    });
    expect(refundReservation).toHaveBeenCalledWith({
      reservationId: "reservation-responses",
      proxyKeyId: "proxy-key-openai",
      actualCostUsd: 0,
      reservedMicroUsd: 2500,
    });
  });
});

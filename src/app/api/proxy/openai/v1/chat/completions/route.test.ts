import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, seedUser } from "@/__tests__/db-helper";
import { modelPrices, proxyKeyPolicies, proxyKeys } from "@/db/schema";
import { hashProxyKeySecret } from "@/lib/proxy/key";
import {
  createReservedUsageEvent,
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

const { POST } = await import("@/app/api/proxy/openai/v1/chat/completions/route");

const fetchMock = vi.fn();
const proxySecret = "akp_chat_test_secret";
const encoder = new TextEncoder();

function request(body: unknown) {
  return new Request("http://localhost/api/proxy/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${proxySecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function sseResponse(body: string, init: ResponseInit = {}) {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(body));
        controller.close();
      },
    }),
    {
      ...init,
      headers: {
        "content-type": "text/event-stream",
        ...(init.headers ?? {}),
      },
    }
  );
}

function seedProxyKey() {
  seedUser(testDbInstance.db, {
    id: "user-chat",
    oidcSub: "oidc-chat",
    email: "chat@example.com",
  });
  testDbInstance.db
    .insert(proxyKeys)
    .values({
      id: "proxy-key-chat",
      userId: "user-chat",
      name: "chat-prod",
      keyHash: hashProxyKeySecret(proxySecret),
      keyHint: "akp_...secret",
      status: "active",
    })
    .run();
  testDbInstance.db
    .insert(proxyKeyPolicies)
    .values({
      id: "policy-chat",
      proxyKeyId: "proxy-key-chat",
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
      id: "price-chat-gpt-5-mini",
      provider: "openai",
      model: "gpt-5-mini",
      inputUsdPer1m: 2,
      outputUsdPer1m: 10,
      active: 1,
    })
    .run();
}

describe("POST /api/proxy/openai/v1/chat/completions", () => {
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
      reservationId: "reservation-chat",
      reservedMicroUsd: 3000,
    });
    vi.mocked(createReservedUsageEvent).mockResolvedValue("usage-chat");
  });

  it("handles max_completion_tokens and Chat Completions usage fields", async () => {
    seedProxyKey();
    fetchMock.mockResolvedValue(
      Response.json(
        {
          id: "chatcmpl_123",
          model: "gpt-5-mini",
          choices: [],
          usage: { prompt_tokens: 80, completion_tokens: 30 },
        },
        { status: 200 }
      )
    );

    const res = await POST(
      request({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: "hello" }],
        max_completion_tokens: 60,
      })
    );
    const body = await res.json();
    const [upstreamUrl, upstreamInit] = fetchMock.mock.calls[0];
    const upstreamHeaders = upstreamInit.headers as Headers;

    expect(res.status).toBe(200);
    expect(body.id).toBe("chatcmpl_123");
    expect(upstreamUrl).toBe("https://api.openai.com/v1/chat/completions");
    expect(upstreamHeaders.get("Authorization")).toBe("Bearer sk-provider-key");
    expect(await new Response(upstreamInit.body).json()).toMatchObject({
      model: "gpt-5-mini",
      max_completion_tokens: 60,
    });
    expect(createReservedUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        proxyKeyId: "proxy-key-chat",
        userId: "user-chat",
        provider: "openai",
        endpoint: "chat_completions",
        model: "gpt-5-mini",
        requestId: "reservation-chat",
      })
    );
    expect(markUsageSucceeded).toHaveBeenCalledWith({
      usageEventId: "usage-chat",
      actualCostUsd: 0.00046,
      inputTokens: 80,
      outputTokens: 30,
      rawUsage: { prompt_tokens: 80, completion_tokens: 30 },
      providerRequestId: "chatcmpl_123",
    });
    expect(releaseConcurrency).toHaveBeenCalledWith({
      reservationId: "reservation-chat",
      proxyKeyId: "proxy-key-chat",
    });
    expect(refundReservation).toHaveBeenCalledWith({
      reservationId: "reservation-chat",
      proxyKeyId: "proxy-key-chat",
      actualCostUsd: 0.00046,
      reservedMicroUsd: 3000,
    });
  });

  it("returns upstream success and cleans up when recording success fails", async () => {
    seedProxyKey();
    vi.mocked(markUsageSucceeded).mockRejectedValue(new Error("db unavailable"));
    fetchMock.mockResolvedValue(
      Response.json(
        {
          id: "chatcmpl_success_write_failed",
          model: "gpt-5-mini",
          choices: [],
          usage: { prompt_tokens: 80, completion_tokens: 30 },
        },
        { status: 200 }
      )
    );

    const res = await POST(
      request({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: "hello" }],
        max_completion_tokens: 60,
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe("chatcmpl_success_write_failed");
    expect(releaseConcurrency).toHaveBeenCalledWith({
      reservationId: "reservation-chat",
      proxyKeyId: "proxy-key-chat",
    });
    expect(refundReservation).toHaveBeenCalledWith({
      reservationId: "reservation-chat",
      proxyKeyId: "proxy-key-chat",
      actualCostUsd: 0.00046,
      reservedMicroUsd: 3000,
    });
  });

  it("streams Chat Completions SSE bytes and injects usage streaming options", async () => {
    seedProxyKey();
    const sse =
      'data: {"id":"chatcmpl_stream","choices":[{"delta":{"content":"hi"}}]}\n\n' +
      'data: {"id":"chatcmpl_stream","choices":[],"usage":{"prompt_tokens":80,"completion_tokens":30}}\n\n' +
      "data: [DONE]\n\n";
    fetchMock.mockResolvedValue(sseResponse(sse, { status: 200 }));

    const res = await POST(
      request({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: "hello" }],
        max_completion_tokens: 60,
        stream: true,
        stream_options: { foo: "bar" },
      })
    );
    const [, upstreamInit] = fetchMock.mock.calls[0];

    await expect(res.text()).resolves.toBe(sse);
    expect(await new Response(upstreamInit.body).json()).toMatchObject({
      stream: true,
      stream_options: { foo: "bar", include_usage: true },
    });
    expect(markUsageSucceeded).toHaveBeenCalledWith({
      usageEventId: "usage-chat",
      actualCostUsd: 0.00046,
      inputTokens: 80,
      outputTokens: 30,
      rawUsage: { prompt_tokens: 80, completion_tokens: 30 },
      providerRequestId: "chatcmpl_stream",
    });
    expect(releaseConcurrency).toHaveBeenCalledWith({
      reservationId: "reservation-chat",
      proxyKeyId: "proxy-key-chat",
    });
    expect(refundReservation).toHaveBeenCalledWith({
      reservationId: "reservation-chat",
      proxyKeyId: "proxy-key-chat",
      actualCostUsd: 0.00046,
      reservedMicroUsd: 3000,
    });
  });

  it("marks Chat Completions streaming usage unknown when final usage is missing", async () => {
    seedProxyKey();
    const sse =
      'data: {"id":"chatcmpl_stream_missing","choices":[{"delta":{"content":"hi"}}]}\n\n' +
      "data: [DONE]\n\n";
    fetchMock.mockResolvedValue(sseResponse(sse, { status: 200 }));

    const res = await POST(
      request({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: "hello" }],
        max_completion_tokens: 60,
        stream: true,
      })
    );

    await expect(res.text()).resolves.toBe(sse);
    expect(markUsageUnknown).toHaveBeenCalledWith({
      usageEventId: "usage-chat",
    });
    expect(refundReservation).toHaveBeenCalledWith({
      reservationId: "reservation-chat",
      proxyKeyId: "proxy-key-chat",
      actualCostUsd: 0.003,
      reservedMicroUsd: 3000,
    });
  });
});

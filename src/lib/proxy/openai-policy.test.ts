import { describe, expect, it } from "vitest";
import {
  estimateTextTokens,
  validateOpenAIPolicy,
} from "@/lib/proxy/openai-policy";
import { calculateTokenCostUsd } from "@/lib/proxy/pricing";
import type { OpenAIProxyEndpoint, ProxyModelPrice } from "@/lib/proxy/types";

const price: ProxyModelPrice = {
  provider: "openai",
  model: "gpt-5-mini",
  inputUsdPer1m: 1,
  outputUsdPer1m: 10,
  active: 1,
};

const basePolicy = {
  allowedModels: ["gpt-5-mini"],
  maxRequestUsd: 1,
  maxOutputTokens: 1_000,
  allowTools: false,
  prices: [price],
};

function validate(
  endpoint: OpenAIProxyEndpoint,
  body: unknown,
  policy: Partial<typeof basePolicy> = {}
) {
  return validateOpenAIPolicy({
    endpoint,
    body,
    policy: { ...basePolicy, ...policy },
  });
}

describe("OpenAI proxy policy", () => {
  it("accepts a valid Responses request and estimates max cost", () => {
    const body = {
      model: "gpt-5-mini",
      input: "Write a concise test.",
      max_output_tokens: 100,
    };

    const result = validate("responses", body);

    expect(result).toMatchObject({
      ok: true,
      endpoint: "responses",
      model: "gpt-5-mini",
      maxOutputTokens: 100,
      normalizedBody: body,
    });
    expect(result.ok && result.estimatedInputTokens).toBe(
      estimateTextTokens(body)
    );
    expect(result.ok && result.estimatedCostUsd).toBe(
      calculateTokenCostUsd({
        price,
        inputTokens: estimateTextTokens(body),
        outputTokens: 100,
      })
    );
  });

  it("requires Responses model and max_output_tokens", () => {
    expect(
      validate("responses", { input: "hello", max_output_tokens: 10 })
    ).toMatchObject({
      ok: false,
      status: 400,
      code: "model_required",
    });

    expect(
      validate("responses", { model: "gpt-5-mini", input: "hello" })
    ).toMatchObject({
      ok: false,
      status: 400,
      code: "max_output_tokens_required",
    });
  });

  it("requires Chat Completions model and a max completion token cap", () => {
    expect(
      validate("chat_completions", {
        messages: [{ role: "user", content: "hello" }],
        max_completion_tokens: 10,
      })
    ).toMatchObject({
      ok: false,
      status: 400,
      code: "model_required",
    });

    expect(
      validate("chat_completions", {
        model: "gpt-5-mini",
        messages: [{ role: "user", content: "hello" }],
      })
    ).toMatchObject({
      ok: false,
      status: 400,
      code: "max_completion_tokens_required",
    });
  });

  it("accepts legacy Chat Completions max_tokens as the output cap", () => {
    const body = {
      model: "gpt-5-mini",
      messages: [{ role: "user", content: "hello" }],
      max_tokens: 12,
    };

    const result = validate("chat_completions", body);

    expect(result).toMatchObject({
      ok: true,
      endpoint: "chat_completions",
      model: "gpt-5-mini",
      maxOutputTokens: 12,
      normalizedBody: body,
    });
  });

  it("rejects Chat Completions n greater than one", () => {
    expect(
      validate("chat_completions", {
        model: "gpt-5-mini",
        messages: [{ role: "user", content: "hello" }],
        max_completion_tokens: 10,
        n: 2,
      })
    ).toMatchObject({
      ok: false,
      status: 400,
      code: "n_not_supported",
    });
  });

  it("rejects tool requests when tools are disabled", () => {
    const bodies = [
      {
        endpoint: "responses" as const,
        body: {
          model: "gpt-5-mini",
          input: "hello",
          max_output_tokens: 10,
          tools: [{ type: "web_search_preview" }],
        },
      },
      {
        endpoint: "chat_completions" as const,
        body: {
          model: "gpt-5-mini",
          messages: [{ role: "user", content: "hello" }],
          max_completion_tokens: 10,
          tools: [{ type: "function", function: { name: "lookup" } }],
        },
      },
    ];

    for (const { endpoint, body } of bodies) {
      expect(validate(endpoint, body)).toMatchObject({
        ok: false,
        status: 400,
        code: "tools_not_allowed",
      });
    }
  });

  it("rejects Chat Completions web search options when tools are disabled", () => {
    expect(
      validate("chat_completions", {
        model: "gpt-5-mini",
        messages: [{ role: "user", content: "hello" }],
        max_completion_tokens: 10,
        web_search_options: {},
      })
    ).toMatchObject({
      ok: false,
      status: 400,
      code: "tools_not_allowed",
    });
  });

  it("rejects Responses image and file input parts", () => {
    const bodies = [
      {
        model: "gpt-5-mini",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: "describe this" },
              { type: "input_image", image_url: "data:image/png;base64,abc" },
            ],
          },
        ],
        max_output_tokens: 10,
      },
      {
        model: "gpt-5-mini",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: "summarize this" },
              { type: "input_file", file_id: "file_123" },
            ],
          },
        ],
        max_output_tokens: 10,
      },
    ];

    for (const body of bodies) {
      expect(validate("responses", body)).toMatchObject({
        ok: false,
        status: 400,
        code: "multimodal_not_supported",
      });
    }
  });

  it("rejects Chat Completions image_url content parts", () => {
    expect(
      validate("chat_completions", {
        model: "gpt-5-mini",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "describe this" },
              {
                type: "image_url",
                image_url: { url: "data:image/png;base64,abc" },
              },
            ],
          },
        ],
        max_completion_tokens: 10,
      })
    ).toMatchObject({
      ok: false,
      status: 400,
      code: "multimodal_not_supported",
    });
  });

  it("rejects Chat Completions unknown non-text content parts", () => {
    expect(
      validate("chat_completions", {
        model: "gpt-5-mini",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "summarize this" },
              {
                type: "input_audio",
                input_audio: { data: "abc", format: "wav" },
              },
            ],
          },
        ],
        max_completion_tokens: 10,
      })
    ).toMatchObject({
      ok: false,
      status: 400,
      code: "multimodal_not_supported",
    });
  });

  it("rejects background Responses requests for the MVP", () => {
    expect(
      validate("responses", {
        model: "gpt-5-mini",
        input: "hello",
        max_output_tokens: 10,
        background: true,
      })
    ).toMatchObject({
      ok: false,
      status: 400,
      code: "background_not_supported",
    });
  });

  it("rejects unknown models before cost calculation", () => {
    expect(
      validate("responses", {
        model: "gpt-5-unknown",
        input: "hello",
        max_output_tokens: 10,
      })
    ).toMatchObject({
      ok: false,
      status: 403,
      code: "model_not_allowed",
    });
  });

  it("rejects requested output token caps over policy", () => {
    expect(
      validate("responses", {
        model: "gpt-5-mini",
        input: "hello",
        max_output_tokens: 1_001,
      })
    ).toMatchObject({
      ok: false,
      status: 403,
      code: "max_output_tokens_exceeded",
    });
  });

  it("returns a policy violation when estimated max request cost is too high", () => {
    expect(
      validate(
        "responses",
        {
          model: "gpt-5-mini",
          input: "hello",
          max_output_tokens: 100,
        },
        { maxRequestUsd: 0.000001 }
      )
    ).toMatchObject({
      ok: false,
      status: 403,
      code: "max_request_cost_exceeded",
    });
  });

  it("rejects request bodies over 1 MB", () => {
    expect(
      validate("responses", {
        model: "gpt-5-mini",
        input: "x".repeat(1_000_000),
        max_output_tokens: 10,
      })
    ).toMatchObject({
      ok: false,
      status: 400,
      code: "request_body_too_large",
    });
  });

  it("measures request body size with UTF-8 bytes instead of JS string length", () => {
    expect(
      validate("responses", {
        model: "gpt-5-mini",
        input: "界".repeat(333_334),
        max_output_tokens: 10,
      })
    ).toMatchObject({
      ok: false,
      status: 400,
      code: "request_body_too_large",
    });
  });
});

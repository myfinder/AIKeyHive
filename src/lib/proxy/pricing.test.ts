import { describe, expect, it } from "vitest";
import {
  calculateTokenCostUsd,
  lookupModelPrice,
} from "@/lib/proxy/pricing";
import type { ProxyModelPrice } from "@/lib/proxy/types";

const activePrice: ProxyModelPrice = {
  provider: "openai",
  model: "gpt-5-mini",
  inputUsdPer1m: 0.25,
  outputUsdPer1m: 2,
  active: 1,
};

const inactivePrice: ProxyModelPrice = {
  provider: "openai",
  model: "gpt-5",
  inputUsdPer1m: 1.25,
  outputUsdPer1m: 10,
  active: 0,
};

describe("proxy pricing", () => {
  it("looks up an active model price", () => {
    const result = lookupModelPrice({
      prices: [activePrice, inactivePrice],
      provider: "openai",
      model: "gpt-5-mini",
    });

    expect(result).toEqual({ ok: true, price: activePrice });
  });

  it("fails closed for inactive and unknown model prices", () => {
    expect(
      lookupModelPrice({
        prices: [activePrice, inactivePrice],
        provider: "openai",
        model: "gpt-5",
      })
    ).toMatchObject({
      ok: false,
      code: "model_price_inactive",
    });

    expect(
      lookupModelPrice({
        prices: [activePrice, inactivePrice],
        provider: "openai",
        model: "gpt-unknown",
      })
    ).toMatchObject({
      ok: false,
      code: "model_price_not_found",
    });
  });

  it("calculates token cost without rounding for enforcement", () => {
    const inputTokens = 333_333;
    const outputTokens = 777_777;

    const cost = calculateTokenCostUsd({
      price: activePrice,
      inputTokens,
      outputTokens,
    });

    expect(cost).toBe(
      (inputTokens * activePrice.inputUsdPer1m) / 1_000_000 +
        (outputTokens * activePrice.outputUsdPer1m) / 1_000_000
    );
  });
});

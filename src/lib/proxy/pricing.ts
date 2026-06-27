import type { ProxyModelPrice, ProxyProvider } from "@/lib/proxy/types";

export type ModelPriceLookupResult =
  | { ok: true; price: ProxyModelPrice }
  | {
      ok: false;
      code: "model_price_not_found" | "model_price_inactive";
      message: string;
    };

export function lookupModelPrice({
  prices,
  provider,
  model,
}: {
  prices: readonly ProxyModelPrice[];
  provider: ProxyProvider;
  model: string;
}): ModelPriceLookupResult {
  const price = prices.find(
    (candidate) => candidate.provider === provider && candidate.model === model
  );

  if (!price) {
    return {
      ok: false,
      code: "model_price_not_found",
      message: `No active price is configured for ${provider}:${model}.`,
    };
  }

  if (price.active !== true && price.active !== 1) {
    return {
      ok: false,
      code: "model_price_inactive",
      message: `The configured price for ${provider}:${model} is inactive.`,
    };
  }

  return { ok: true, price };
}

export function calculateTokenCostUsd({
  price,
  inputTokens,
  outputTokens,
}: {
  price: Pick<ProxyModelPrice, "inputUsdPer1m" | "outputUsdPer1m">;
  inputTokens: number;
  outputTokens: number;
}): number {
  return (
    (inputTokens * price.inputUsdPer1m) / 1_000_000 +
    (outputTokens * price.outputUsdPer1m) / 1_000_000
  );
}

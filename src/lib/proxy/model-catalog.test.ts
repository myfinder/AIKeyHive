import { describe, expect, it } from "vitest";
import {
  filterProxyModels,
  formatModelPriceLine,
  selectedModelsSummary,
} from "@/lib/proxy/model-catalog";

const models = [
  {
    provider: "openai" as const,
    model: "gpt-5.4-mini",
    inputUsdPer1m: 0.75,
    cachedInputUsdPer1m: 0.075,
    outputUsdPer1m: 4.5,
  },
  {
    provider: "openai" as const,
    model: "gpt-5.5-pro",
    inputUsdPer1m: 30,
    cachedInputUsdPer1m: null,
    outputUsdPer1m: 180,
  },
];

describe("proxy model catalog display helpers", () => {
  it("formats a model row as model pricing only", () => {
    expect(formatModelPriceLine(models[0])).toBe(
      "input $0.75 / cached $0.075 / output $4.50 per 1M tokens"
    );
    expect(formatModelPriceLine(models[1])).toBe(
      "input $30.00 / cached n/a / output $180.00 per 1M tokens"
    );
  });

  it("filters models by model id case-insensitively", () => {
    expect(filterProxyModels(models, "MINI").map((model) => model.model))
      .toEqual(["gpt-5.4-mini"]);
    expect(filterProxyModels(models, "").map((model) => model.model)).toEqual([
      "gpt-5.4-mini",
      "gpt-5.5-pro",
    ]);
  });

  it("summarizes selected model ids for the collapsed trigger", () => {
    expect(selectedModelsSummary([])).toBe("Select models");
    expect(selectedModelsSummary(["gpt-5.4-mini"])).toBe("gpt-5.4-mini");
    expect(
      selectedModelsSummary(["gpt-5.4-mini", "gpt-5.4-nano", "gpt-5-mini"])
    ).toBe("gpt-5.4-mini, gpt-5.4-nano, gpt-5-mini");
  });
});

import {
  allowedModelsHelpText,
  defaultAllowedModelsCsv,
  proxyKeyFormFieldHelp,
} from "@/lib/proxy/model-policy";

describe("proxy model policy copy", () => {
  it("uses current OpenAI model IDs as the default allowed models CSV", () => {
    expect(defaultAllowedModelsCsv).toBe(
      "gpt-5.5,gpt-5.4-mini,gpt-5.4-nano"
    );
  });

  it("explains that allowed models are comma-separated model IDs", () => {
    expect(allowedModelsHelpText.toLowerCase()).toContain(
      "comma-separated model ids"
    );
    expect(allowedModelsHelpText).toContain(defaultAllowedModelsCsv);
  });

  it("provides tooltip help for every proxy key create field", () => {
    expect(Object.keys(proxyKeyFormFieldHelp).sort()).toEqual([
      "allowedModels",
      "dailyLimitUsd",
      "hourlyLimitUsd",
      "maxConcurrency",
      "maxOutputTokens",
      "maxRequestUsd",
      "monthlyLimitUsd",
      "name",
    ]);

    for (const text of Object.values(proxyKeyFormFieldHelp)) {
      expect(text.length).toBeGreaterThan(20);
    }

    expect(proxyKeyFormFieldHelp.maxOutputTokens).toContain(
      "max_output_tokens"
    );
    expect(proxyKeyFormFieldHelp.maxOutputTokens).toContain(
      "max_completion_tokens"
    );
  });

  it("documents the actual create form validation rules", () => {
    expect(proxyKeyFormFieldHelp.name).toContain("required");
    expect(proxyKeyFormFieldHelp.name).toContain("1-100");
    expect(proxyKeyFormFieldHelp.name).toContain("letters, numbers, hyphens, or underscores");

    expect(proxyKeyFormFieldHelp.allowedModels).toContain("required");
    expect(proxyKeyFormFieldHelp.allowedModels).toContain("comma-separated");
    expect(proxyKeyFormFieldHelp.allowedModels).toContain("active price");

    expect(proxyKeyFormFieldHelp.hourlyLimitUsd).toContain("positive USD");
    expect(proxyKeyFormFieldHelp.hourlyLimitUsd).toContain("hourly <= daily");
    expect(proxyKeyFormFieldHelp.dailyLimitUsd).toContain("daily <= monthly");
    expect(proxyKeyFormFieldHelp.monthlyLimitUsd).toContain("positive USD");

    expect(proxyKeyFormFieldHelp.maxRequestUsd).toContain("positive USD");
    expect(proxyKeyFormFieldHelp.maxOutputTokens).toContain("positive integer");
    expect(proxyKeyFormFieldHelp.maxConcurrency).toContain("integer from 1 to 10");
  });
});

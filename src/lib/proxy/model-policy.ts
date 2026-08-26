export const defaultAllowedModelsCsv =
  "gpt-5.6-sol,gpt-5.6-terra,gpt-5.6-luna";

export const proxyKeyFormFieldHelp = {
  name: "Name is required. Use 1-100 characters: letters, numbers, hyphens, or underscores. Example: team-prod.",
  allowedModels:
    "Allowed models are required. Select one or more models this key can call. The list only includes models with an active OpenAI price in Admin Model Prices.",
  hourlyLimitUsd:
    "Required positive USD value. This is the hourly budget window, and hourly <= daily must be true.",
  dailyLimitUsd:
    "Required positive USD value. This is the daily budget window, and daily <= monthly must be true.",
  monthlyLimitUsd:
    "Required positive USD value. This is the monthly budget window for this Proxy Key.",
  maxRequestUsd:
    "Required positive USD value. A request is rejected before reaching OpenAI if its estimated cost is above this value.",
  maxOutputTokens:
    "Required positive integer. Responses API uses max_output_tokens; Chat Completions uses max_completion_tokens.",
  maxConcurrency:
    "Required integer from 1 to 10. This caps the number of in-flight requests for this key at the same time.",
} as const;

export const allowedModelsHelpText = proxyKeyFormFieldHelp.allowedModels;

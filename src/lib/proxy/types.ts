export type ProxyProvider = "openai" | "anthropic" | "gemini";

export type OpenAIProxyEndpoint = "responses" | "chat_completions";

export interface ProxyModelPrice {
  provider: ProxyProvider;
  model: string;
  inputUsdPer1m: number;
  cachedInputUsdPer1m?: number | null;
  outputUsdPer1m: number;
  active: boolean | number;
}

export interface OpenAIProxyPolicy {
  allowedModels: readonly string[];
  maxRequestUsd: number;
  maxOutputTokens: number;
  allowTools: boolean;
  prices: readonly ProxyModelPrice[];
}

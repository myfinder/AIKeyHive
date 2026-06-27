import type { OpenAIProxyEndpoint } from "@/lib/proxy/types";

export type OpenAIForwardResult =
  | { ok: true; response: Response }
  | { ok: false; status: 503; code: string; message: string };

const OPENAI_ENDPOINT_PATHS: Record<OpenAIProxyEndpoint, string> = {
  responses: "/v1/responses",
  chat_completions: "/v1/chat/completions",
};

export async function forwardOpenAIRequest(input: {
  endpoint: OpenAIProxyEndpoint;
  body: unknown;
}): Promise<OpenAIForwardResult> {
  const apiKey = process.env.OPENAI_PROXY_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      status: 503,
      code: "openai_proxy_not_configured",
      message: "OpenAI proxy upstream is not configured.",
    };
  }

  const headers = new Headers({
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  });
  if (process.env.OPENAI_ORG_ID) {
    headers.set("OpenAI-Organization", process.env.OPENAI_ORG_ID);
  }

  const response = await fetch(
    `https://api.openai.com${OPENAI_ENDPOINT_PATHS[input.endpoint]}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(input.body),
    }
  );

  return { ok: true, response };
}

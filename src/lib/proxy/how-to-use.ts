export type ProxyUsageApi = "responses" | "chatCompletions";
export type ProxyUsageLanguage = "python" | "typescript" | "curl";
export type ProxyCompatibilityStatus =
  | "Supported"
  | "Limited"
  | "Not supported";

export type ProxyUsageExamples = Record<
  ProxyUsageLanguage,
  Record<ProxyUsageApi, string>
>;

export type ProxyCompatibilityRow = {
  area: string;
  status: ProxyCompatibilityStatus;
  detail: string;
};

const defaultProxyKeyPlaceholder = "akp_your_proxy_key";
const defaultModel = "gpt-5-mini";
const samplePrompt = "Reply with exactly: ok";

export const proxyCompatibilityNotice =
  "AIKeyHive Proxy Keys are not a full OpenAI API proxy. They are intended for development and experiments where cost guards matter more than full production compatibility.";

export const proxyCompatibilityRows: ProxyCompatibilityRow[] = [
  {
    area: "Responses API",
    status: "Supported",
    detail:
      "POST /responses with text-only input and max_output_tokens. Streaming SSE is passed through.",
  },
  {
    area: "Chat Completions",
    status: "Supported",
    detail:
      "POST /chat/completions with text-only messages and max_completion_tokens or max_tokens. Streaming SSE is passed through.",
  },
  {
    area: "Streaming accounting",
    status: "Limited",
    detail:
      "SSE bytes are forwarded unchanged while usage is observed for budget reconciliation. Chat streaming injects stream_options.include_usage.",
  },
  {
    area: "Multimodal input",
    status: "Not supported",
    detail:
      "Image, file, audio, and other multimodal request parts are rejected by the proxy policy.",
  },
  {
    area: "Tools and functions",
    status: "Not supported",
    detail:
      "Tool, function, and web-search requests are not enabled for self-serve Proxy Keys.",
  },
  {
    area: "Background Responses",
    status: "Not supported",
    detail: "Responses requests with background: true are rejected.",
  },
  {
    area: "Other OpenAI endpoints",
    status: "Not supported",
    detail:
      "Files, embeddings, images, audio, batches, fine-tuning, Realtime, and Responses retrieve/cancel/delete endpoints are not proxied.",
  },
];

export function buildOpenAiProxyBaseUrl(origin: string) {
  const normalizedOrigin = origin.replace(/\/+$/, "");
  return `${normalizedOrigin}/api/proxy/openai/v1`;
}

export function buildProxyUsageExamples(
  baseUrl: string,
  proxyKey = defaultProxyKeyPlaceholder
): ProxyUsageExamples {
  return {
    python: {
      responses: `from openai import OpenAI

client = OpenAI(
    api_key="${proxyKey}",
    base_url="${baseUrl}",
)

response = client.responses.create(
    model="${defaultModel}",
    input="${samplePrompt}",
    max_output_tokens=64,
)

print(response.output_text)`,
      chatCompletions: `from openai import OpenAI

client = OpenAI(
    api_key="${proxyKey}",
    base_url="${baseUrl}",
)

completion = client.chat.completions.create(
    model="${defaultModel}",
    messages=[
        {"role": "user", "content": "${samplePrompt}"}
    ],
    max_completion_tokens=64,
)

print(completion.choices[0].message.content)`,
    },
    typescript: {
      responses: `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "${proxyKey}",
  baseURL: "${baseUrl}",
});

const response = await client.responses.create({
  model: "${defaultModel}",
  input: "${samplePrompt}",
  max_output_tokens: 64,
});

console.log(response.output_text);`,
      chatCompletions: `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "${proxyKey}",
  baseURL: "${baseUrl}",
});

const completion = await client.chat.completions.create({
  model: "${defaultModel}",
  messages: [{ role: "user", content: "${samplePrompt}" }],
  max_completion_tokens: 64,
});

console.log(completion.choices[0]?.message?.content);`,
    },
    curl: {
      responses: `curl ${baseUrl}/responses \\
  -H "Authorization: Bearer ${proxyKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${defaultModel}",
    "input": "${samplePrompt}",
    "max_output_tokens": 64
  }'`,
      chatCompletions: `curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer ${proxyKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${defaultModel}",
    "messages": [{"role": "user", "content": "${samplePrompt}"}],
    "max_completion_tokens": 64
  }'`,
    },
  };
}

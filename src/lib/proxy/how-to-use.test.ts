import {
  buildOpenAiProxyBaseUrl,
  buildProxyUsageExamples,
  proxyCompatibilityNotice,
  proxyCompatibilityRows,
} from "@/lib/proxy/how-to-use";

describe("proxy how-to-use helpers", () => {
  it("builds the OpenAI proxy base URL from the current app origin", () => {
    expect(buildOpenAiProxyBaseUrl("https://aikeyhive-toggle.vercel.app")).toBe(
      "https://aikeyhive-toggle.vercel.app/api/proxy/openai/v1"
    );
    expect(buildOpenAiProxyBaseUrl("http://localhost:3001/")).toBe(
      "http://localhost:3001/api/proxy/openai/v1"
    );
  });

  it("generates Responses and Chat Completions examples for each client", () => {
    const baseUrl = "https://aikeyhive-toggle.vercel.app/api/proxy/openai/v1";
    const examples = buildProxyUsageExamples(baseUrl);

    expect(examples.python.responses).toContain(
      'base_url="https://aikeyhive-toggle.vercel.app/api/proxy/openai/v1"'
    );
    expect(examples.python.responses).toContain("client.responses.create");
    expect(examples.python.chatCompletions).toContain(
      "client.chat.completions.create"
    );

    expect(examples.typescript.responses).toContain(
      'baseURL: "https://aikeyhive-toggle.vercel.app/api/proxy/openai/v1"'
    );
    expect(examples.typescript.responses).toContain("client.responses.create");
    expect(examples.typescript.chatCompletions).toContain(
      "client.chat.completions.create"
    );

    expect(examples.curl.responses).toContain(
      "https://aikeyhive-toggle.vercel.app/api/proxy/openai/v1/responses"
    );
    expect(examples.curl.chatCompletions).toContain(
      "https://aikeyhive-toggle.vercel.app/api/proxy/openai/v1/chat/completions"
    );
  });

  it("documents the proxy compatibility warning and unsupported areas", () => {
    expect(proxyCompatibilityNotice).toContain("not a full OpenAI API proxy");
    expect(proxyCompatibilityNotice).toContain("development");

    expect(proxyCompatibilityRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area: "Responses API",
          status: "Supported",
        }),
        expect.objectContaining({
          area: "Chat Completions",
          status: "Supported",
        }),
        expect.objectContaining({
          area: "Other OpenAI endpoints",
          status: "Not supported",
        }),
      ])
    );
    expect(proxyCompatibilityRows.map((row) => row.detail).join("\n")).toContain(
      "multimodal"
    );
    expect(proxyCompatibilityRows.map((row) => row.detail).join("\n")).toContain(
      "streaming"
    );
  });
});

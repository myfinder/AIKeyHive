import { describe, expect, it, vi } from "vitest";
import { observeSseStream } from "@/lib/proxy/sse";

const encoder = new TextEncoder();

function streamFromStrings(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  return await new Response(stream).text();
}

describe("observeSseStream", () => {
  it("parses data frames and passes original bytes through unchanged", async () => {
    const onUsage = vi.fn();
    const onDone = vi.fn();
    const output = observeSseStream({
      body: streamFromStrings([
        'data: {"id":"chatcmpl_123","usage":{"prompt_tokens":11,"completion_tokens":7}}\n\n',
      ]),
      onUsage,
      onDone,
      onError: vi.fn(),
    });

    await expect(readStream(output)).resolves.toBe(
      'data: {"id":"chatcmpl_123","usage":{"prompt_tokens":11,"completion_tokens":7}}\n\n'
    );
    expect(onUsage).toHaveBeenCalledWith({
      inputTokens: 11,
      outputTokens: 7,
      raw: { prompt_tokens: 11, completion_tokens: 7 },
      providerRequestId: "chatcmpl_123",
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("ignores comments and empty frames", async () => {
    const onUsage = vi.fn();

    await readStream(
      observeSseStream({
        body: streamFromStrings([
          ": keepalive\n\n",
          "\n",
          'event: ping\ndata: {"usage":null}\n\n',
        ]),
        onUsage,
        onDone: vi.fn(),
        onError: vi.fn(),
      })
    );

    expect(onUsage).not.toHaveBeenCalled();
  });

  it("handles chunks split across frame boundaries", async () => {
    const onUsage = vi.fn();
    const bytes = [
      "event: response.completed\ndata: {\"id\":\"resp_123\",\"usage\":{\"input_tokens\":",
      "13,\"output_tokens\":5}}\n",
      "\n",
    ];

    await expect(
      readStream(
        observeSseStream({
          body: streamFromStrings(bytes),
          onUsage,
          onDone: vi.fn(),
          onError: vi.fn(),
        })
      )
    ).resolves.toBe(bytes.join(""));
    expect(onUsage).toHaveBeenCalledWith({
      inputTokens: 13,
      outputTokens: 5,
      raw: { input_tokens: 13, output_tokens: 5 },
      providerRequestId: "resp_123",
    });
  });

  it("detects Chat Completions final chunks with usage", async () => {
    const onUsage = vi.fn();

    await readStream(
      observeSseStream({
        body: streamFromStrings([
          'data: {"id":"chatcmpl_456","choices":[],"usage":{"prompt_tokens":21,"completion_tokens":4}}\n\n',
        ]),
        onUsage,
        onDone: vi.fn(),
        onError: vi.fn(),
      })
    );

    expect(onUsage).toHaveBeenCalledWith({
      inputTokens: 21,
      outputTokens: 4,
      raw: { prompt_tokens: 21, completion_tokens: 4 },
      providerRequestId: "chatcmpl_456",
    });
  });

  it("detects Responses response.completed events with usage", async () => {
    const onUsage = vi.fn();

    await readStream(
      observeSseStream({
        body: streamFromStrings([
          'event: response.completed\ndata: {"response":{"id":"resp_456","usage":{"input_tokens":34,"output_tokens":8}}}\n\n',
        ]),
        onUsage,
        onDone: vi.fn(),
        onError: vi.fn(),
      })
    );

    expect(onUsage).toHaveBeenCalledWith({
      inputTokens: 34,
      outputTokens: 8,
      raw: { input_tokens: 34, output_tokens: 8 },
      providerRequestId: "resp_456",
    });
  });

  it("passes malformed JSON data frames through and reports parse errors", async () => {
    const onError = vi.fn();
    const sse = 'event: response.completed\ndata: {"response":\n\n';
    const output = observeSseStream({
      body: streamFromStrings([sse]),
      onUsage: vi.fn(),
      onDone: vi.fn(),
      onError,
    });

    await expect(readStream(output)).resolves.toBe(sse);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(SyntaxError);
  });

  it("reports source stream errors", async () => {
    const error = new Error("source failed");
    const onError = vi.fn();
    const output = observeSseStream({
      body: new ReadableStream({
        pull() {
          throw error;
        },
      }),
      onUsage: vi.fn(),
      onDone: vi.fn(),
      onError,
    });

    await expect(readStream(output)).rejects.toThrow("source failed");
    expect(onError).toHaveBeenCalledWith(error);
  });
});

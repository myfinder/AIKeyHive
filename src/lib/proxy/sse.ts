export type ObservedSseUsage = {
  inputTokens: number;
  outputTokens: number;
  raw: unknown;
  providerRequestId?: string;
};

type SseFrame = {
  event?: string;
  data: string;
};

export function observeSseStream(input: {
  body: ReadableStream<Uint8Array>;
  onUsage: (usage: ObservedSseUsage) => void | Promise<void>;
  onDone: () => void | Promise<void>;
  onError: (error: unknown) => void | Promise<void>;
  onCancel?: (reason: unknown) => void | Promise<void>;
}): ReadableStream<Uint8Array> {
  const reader = input.body.getReader();
  const decoder = new TextDecoder();
  let textBuffer = "";

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (error) {
        await notifyError(error);
        controller.error(error);
        return;
      }

      if (result.done) {
        const tail = decoder.decode();
        if (tail.length > 0) {
          textBuffer += tail;
        }
        await parseBufferedFrames({ flush: true });
        await notifyDone();
        controller.close();
        return;
      }

      controller.enqueue(result.value);
      textBuffer += decoder.decode(result.value, { stream: true });
      await parseBufferedFrames({ flush: false });
    },
    async cancel(reason) {
      let cancelError: unknown;
      try {
        await reader.cancel(reason);
      } catch (error) {
        cancelError = error;
      }

      try {
        await input.onCancel?.(reason);
      } catch (error) {
        await notifyError(error);
      }

      if (cancelError) {
        throw cancelError;
      }
    },
  });

  async function parseBufferedFrames(options: { flush: boolean }): Promise<void> {
    while (true) {
      const boundary = findFrameBoundary(textBuffer);
      if (!boundary) {
        break;
      }

      const frameText = textBuffer.slice(0, boundary.index);
      textBuffer = textBuffer.slice(boundary.index + boundary.length);
      await observeFrame(frameText);
    }

    if (options.flush && textBuffer.length > 0) {
      await observeFrame(textBuffer);
      textBuffer = "";
    }
  }

  async function observeFrame(frameText: string): Promise<void> {
    const frame = parseSseFrame(frameText);
    if (!frame || frame.data === "[DONE]") {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(frame.data) as unknown;
    } catch (error) {
      await notifyError(error);
      return;
    }

    const usage = extractObservedUsage(parsed, frame.event);
    if (usage) {
      await notifyUsage(usage);
    }
  }

  async function notifyUsage(usage: ObservedSseUsage): Promise<void> {
    try {
      await input.onUsage(usage);
    } catch (error) {
      await notifyError(error);
    }
  }

  async function notifyDone(): Promise<void> {
    try {
      await input.onDone();
    } catch (error) {
      await notifyError(error);
    }
  }

  async function notifyError(error: unknown): Promise<void> {
    try {
      await input.onError(error);
    } catch {
      // Accounting callbacks must not tear down the pass-through stream.
    }
  }
}

function findFrameBoundary(
  text: string
): { index: number; length: number } | null {
  const delimiters = ["\r\n\r\n", "\n\n", "\r\r"];
  let match: { index: number; length: number } | null = null;

  for (const delimiter of delimiters) {
    const index = text.indexOf(delimiter);
    if (index === -1) {
      continue;
    }
    if (!match || index < match.index) {
      match = { index, length: delimiter.length };
    }
  }

  return match;
}

function parseSseFrame(frameText: string): SseFrame | null {
  let event: string | undefined;
  const data: string[] = [];

  for (const line of frameText.split(/\r\n|\r|\n/)) {
    if (line.length === 0 || line.startsWith(":")) {
      continue;
    }

    const colonIndex = line.indexOf(":");
    const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
    let value = colonIndex === -1 ? "" : line.slice(colonIndex + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }

    if (field === "event") {
      event = value;
    } else if (field === "data") {
      data.push(value);
    }
  }

  if (data.length === 0) {
    return null;
  }

  return { event, data: data.join("\n") };
}

function extractObservedUsage(
  value: unknown,
  event?: string
): ObservedSseUsage | null {
  const usageOwner =
    event === "response.completed" && isRecord(value) && isRecord(value.response)
      ? value.response
      : value;

  if (!isRecord(usageOwner) || !isRecord(usageOwner.usage)) {
    return null;
  }

  const inputTokens = readTokenCount(
    usageOwner.usage.input_tokens,
    usageOwner.usage.prompt_tokens
  );
  const outputTokens = readTokenCount(
    usageOwner.usage.output_tokens,
    usageOwner.usage.completion_tokens
  );
  if (inputTokens === null || outputTokens === null) {
    return null;
  }

  const providerRequestId =
    typeof usageOwner.id === "string" && usageOwner.id.length > 0
      ? usageOwner.id
      : undefined;

  return {
    inputTokens,
    outputTokens,
    raw: usageOwner.usage,
    ...(providerRequestId ? { providerRequestId } : {}),
  };
}

function readTokenCount(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import { calculateTokenCostUsd, lookupModelPrice } from "@/lib/proxy/pricing";
import type {
  OpenAIProxyEndpoint,
  OpenAIProxyPolicy,
} from "@/lib/proxy/types";

export type { OpenAIProxyEndpoint } from "@/lib/proxy/types";

export type OpenAIPolicyResult =
  | {
      ok: true;
      endpoint: OpenAIProxyEndpoint;
      model: string;
      estimatedInputTokens: number;
      maxOutputTokens: number;
      estimatedCostUsd: number;
      normalizedBody: unknown;
    }
  | { ok: false; status: 400 | 403; code: string; message: string };

const MAX_REQUEST_BODY_BYTES = 1_000_000;
const RESPONSES_TEXT_PART_TYPES = new Set([
  "input_text",
  "output_text",
  "text",
]);
const RESPONSES_TEXT_CONTAINER_TYPES = new Set(["message"]);
const UNSUPPORTED_CONTENT_PART_TYPES = new Set([
  "input_image",
  "image_url",
  "input_file",
  "file",
  "file_search",
]);

export function estimateTextTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 3);
}

export function validateOpenAIPolicy({
  endpoint,
  body,
  policy,
}: {
  endpoint: OpenAIProxyEndpoint;
  body: unknown;
  policy: OpenAIProxyPolicy;
}): OpenAIPolicyResult {
  const serializedBody = stringifyBody(body);
  if (!serializedBody) {
    return fail(400, "invalid_request_body", "Request body must be JSON.");
  }

  if (utf8ByteLength(serializedBody) > MAX_REQUEST_BODY_BYTES) {
    return fail(
      400,
      "request_body_too_large",
      "Request body must be 1 MB or smaller."
    );
  }

  if (!isObjectBody(body)) {
    return fail(400, "invalid_request_body", "Request body must be an object.");
  }

  const endpointValidation =
    endpoint === "responses"
      ? validateResponsesBody(body)
      : validateChatCompletionsBody(body);

  if (!endpointValidation.ok) {
    return endpointValidation;
  }

  const { model, maxOutputTokens } = endpointValidation;

  if (!policy.allowedModels.includes(model)) {
    return fail(
      403,
      "model_not_allowed",
      `Model ${model} is not allowed for this proxy key.`
    );
  }

  if (!policy.allowTools && hasToolRequest(body)) {
    return fail(
      400,
      "tools_not_allowed",
      "Tool requests are not allowed for this proxy key."
    );
  }

  if (maxOutputTokens > policy.maxOutputTokens) {
    return fail(
      403,
      "max_output_tokens_exceeded",
      `Requested max output tokens exceed the proxy key policy.`
    );
  }

  const priceResult = lookupModelPrice({
    prices: policy.prices,
    provider: "openai",
    model,
  });

  if (!priceResult.ok) {
    return fail(403, "model_pricing_unavailable", priceResult.message);
  }

  const estimatedInputTokens = estimateTextTokens(body);
  const estimatedCostUsd = calculateTokenCostUsd({
    price: priceResult.price,
    inputTokens: estimatedInputTokens,
    outputTokens: maxOutputTokens,
  });

  if (estimatedCostUsd > policy.maxRequestUsd) {
    return fail(
      403,
      "max_request_cost_exceeded",
      "Estimated maximum request cost exceeds the proxy key policy."
    );
  }

  return {
    ok: true,
    endpoint,
    model,
    estimatedInputTokens,
    maxOutputTokens,
    estimatedCostUsd,
    normalizedBody: body,
  };
}

function validateResponsesBody(
  body: Record<string, unknown>
):
  | { ok: true; model: string; maxOutputTokens: number }
  | Extract<OpenAIPolicyResult, { ok: false }> {
  const model = readModel(body);
  if (!model) {
    return fail(400, "model_required", "Responses requests require a model.");
  }

  const maxOutputTokens = body.max_output_tokens;
  if (!isPositiveInteger(maxOutputTokens)) {
    return fail(
      400,
      "max_output_tokens_required",
      "Responses requests require positive integer max_output_tokens."
    );
  }

  if (body.background === true) {
    return fail(
      400,
      "background_not_supported",
      "Background Responses requests are not supported by the proxy MVP."
    );
  }

  if (!isResponsesInputTextOnly(body.input)) {
    return fail(
      400,
      "multimodal_not_supported",
      "Responses requests with multimodal input are not supported by the proxy MVP."
    );
  }

  return { ok: true, model, maxOutputTokens };
}

function validateChatCompletionsBody(
  body: Record<string, unknown>
):
  | { ok: true; model: string; maxOutputTokens: number }
  | Extract<OpenAIPolicyResult, { ok: false }> {
  const model = readModel(body);
  if (!model) {
    return fail(
      400,
      "model_required",
      "Chat Completions requests require a model."
    );
  }

  const maxOutputTokens = Object.hasOwn(body, "max_completion_tokens")
    ? body.max_completion_tokens
    : body.max_tokens;

  if (!isPositiveInteger(maxOutputTokens)) {
    return fail(
      400,
      "max_completion_tokens_required",
      "Chat Completions requests require positive integer max_completion_tokens or max_tokens."
    );
  }

  if (typeof body.n === "number" && body.n > 1) {
    return fail(
      400,
      "n_not_supported",
      "Chat Completions requests with n greater than 1 are not supported."
    );
  }

  if (!areChatMessagesTextOnly(body.messages)) {
    return fail(
      400,
      "multimodal_not_supported",
      "Chat Completions requests with multimodal content are not supported by the proxy MVP."
    );
  }

  return { ok: true, model, maxOutputTokens };
}

function stringifyBody(body: unknown): string | null {
  try {
    return JSON.stringify(body);
  } catch {
    return null;
  }
}

function isObjectBody(body: unknown): body is Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readModel(body: Record<string, unknown>): string | null {
  return typeof body.model === "string" && body.model.trim().length > 0
    ? body.model
    : null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function hasToolRequest(body: Record<string, unknown>): boolean {
  if (Array.isArray(body.tools)) {
    return body.tools.length > 0;
  }

  if (body.tools !== undefined && body.tools !== null) {
    return true;
  }

  return (
    body.tool_choice !== undefined ||
    body.parallel_tool_calls !== undefined ||
    body.web_search_options !== undefined ||
    body.function_call !== undefined ||
    body.functions !== undefined
  );
}

function isResponsesInputTextOnly(input: unknown): boolean {
  if (input === undefined) {
    return true;
  }

  if (typeof input === "string") {
    return true;
  }

  if (Array.isArray(input)) {
    return input.every(isResponsesInputItemTextOnly);
  }

  return isResponsesInputItemTextOnly(input);
}

function isResponsesInputItemTextOnly(item: unknown): boolean {
  if (typeof item === "string") {
    return true;
  }

  if (Array.isArray(item)) {
    return item.every(isResponsesInputItemTextOnly);
  }

  if (!isRecord(item)) {
    return false;
  }

  const type = readType(item);
  if (type && UNSUPPORTED_CONTENT_PART_TYPES.has(type)) {
    return false;
  }

  if (Object.hasOwn(item, "content")) {
    if (
      type &&
      !RESPONSES_TEXT_CONTAINER_TYPES.has(type) &&
      !RESPONSES_TEXT_PART_TYPES.has(type)
    ) {
      return false;
    }

    return isResponsesContentTextOnly(item.content);
  }

  if (!type) {
    return false;
  }

  return RESPONSES_TEXT_PART_TYPES.has(type) && typeof item.text === "string";
}

function isResponsesContentTextOnly(content: unknown): boolean {
  if (typeof content === "string") {
    return true;
  }

  if (Array.isArray(content)) {
    return content.every(isResponsesContentPartTextOnly);
  }

  return isResponsesContentPartTextOnly(content);
}

function isResponsesContentPartTextOnly(part: unknown): boolean {
  if (typeof part === "string") {
    return true;
  }

  if (!isRecord(part)) {
    return false;
  }

  const type = readType(part);
  if (!type || UNSUPPORTED_CONTENT_PART_TYPES.has(type)) {
    return false;
  }

  return RESPONSES_TEXT_PART_TYPES.has(type) && typeof part.text === "string";
}

function areChatMessagesTextOnly(messages: unknown): boolean {
  if (messages === undefined) {
    return true;
  }

  if (!Array.isArray(messages)) {
    return false;
  }

  return messages.every((message) => {
    if (!isRecord(message) || !Object.hasOwn(message, "content")) {
      return true;
    }

    return isChatMessageContentTextOnly(message.content);
  });
}

function isChatMessageContentTextOnly(content: unknown): boolean {
  if (typeof content === "string") {
    return true;
  }

  if (!Array.isArray(content)) {
    return false;
  }

  return content.every(
    (part) =>
      isRecord(part) && part.type === "text" && typeof part.text === "string"
  );
}

function readType(value: Record<string, unknown>): string | null {
  return typeof value.type === "string" ? value.type : null;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function fail(
  status: 400 | 403,
  code: string,
  message: string
): Extract<OpenAIPolicyResult, { ok: false }> {
  return { ok: false, status, code, message };
}

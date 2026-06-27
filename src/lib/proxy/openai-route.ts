import { randomUUID } from "node:crypto";
import { calculateTokenCostUsd, lookupModelPrice } from "@/lib/proxy/pricing";
import { authenticateOpenAIProxyKey } from "@/lib/proxy/auth";
import { forwardOpenAIRequest } from "@/lib/proxy/openai-forward";
import { validateOpenAIPolicy } from "@/lib/proxy/openai-policy";
import {
  refundReservation,
  releaseConcurrency,
  reserveBudget,
} from "@/lib/proxy/reservation";
import {
  createReservedUsageEvent,
  markUsageFailed,
  markUsageSucceeded,
  markUsageUnknown,
} from "@/lib/proxy/usage";
import type { OpenAIProxyEndpoint } from "@/lib/proxy/types";

type ReservationState = {
  reservationId: string;
  reservedMicroUsd: number;
};

type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  rawUsage: unknown;
};

const SAFE_UPSTREAM_RESPONSE_HEADERS = [
  "content-type",
  "openai-request-id",
  "x-request-id",
];

export async function handleOpenAIProxyRequest(input: {
  req: Request;
  endpoint: OpenAIProxyEndpoint;
}): Promise<Response> {
  const auth = await authenticateOpenAIProxyKey(input.req);
  if (!auth.ok) {
    return proxyError(auth.status, auth.code, auth.message);
  }

  let body: unknown;
  try {
    body = await input.req.json();
  } catch {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }

  if (isRecord(body) && body.stream === true) {
    return proxyError(
      400,
      "streaming_not_supported_in_core",
      "Streaming requests are not supported by this proxy route yet."
    );
  }

  const policyResult = validateOpenAIPolicy({
    endpoint: input.endpoint,
    body,
    policy: auth.policy,
  });
  if (!policyResult.ok) {
    return proxyError(
      policyResult.status,
      policyResult.code,
      policyResult.message
    );
  }

  const routeRequestId = randomUUID();
  let reservation: ReservationState | null = null;
  let usageEventId: string | null = null;

  try {
    const reservationResult = await reserveBudget({
      proxyKeyId: auth.proxyKey.id,
      estimatedCostUsd: policyResult.estimatedCostUsd,
      hourlyLimitUsd: auth.policyRow.hourlyLimitUsd,
      dailyLimitUsd: auth.policyRow.dailyLimitUsd,
      monthlyLimitUsd: auth.policyRow.monthlyLimitUsd,
      maxConcurrency: auth.policyRow.maxConcurrency,
      reservationId: routeRequestId,
    });

    if (!reservationResult.ok) {
      return proxyError(
        reservationResult.status,
        reservationResult.code,
        reservationResult.message
      );
    }

    reservation = {
      reservationId: reservationResult.reservationId,
      reservedMicroUsd: reservationResult.reservedMicroUsd,
    };
    usageEventId = await createReservedUsageEvent({
      proxyKeyId: auth.proxyKey.id,
      userId: auth.userId,
      provider: "openai",
      endpoint: input.endpoint,
      model: policyResult.model,
      estimatedCostUsd: policyResult.estimatedCostUsd,
      reservedCostUsd: reservation.reservedMicroUsd / 1_000_000,
      requestId: reservation.reservationId,
    });

    const forwardResult = await forwardOpenAIRequest({
      endpoint: input.endpoint,
      body: policyResult.normalizedBody,
    });

    if (!forwardResult.ok) {
      await safeMarkFailed(usageEventId, forwardResult.code);
      await cleanupReservation(auth.proxyKey.id, reservation, 0);
      return proxyError(
        forwardResult.status,
        forwardResult.code,
        forwardResult.message
      );
    }

    const upstream = forwardResult.response;
    if (!upstream.ok) {
      const errorCode = await extractUpstreamErrorCode(upstream);
      await safeMarkFailed(usageEventId, errorCode);
      await cleanupReservation(auth.proxyKey.id, reservation, 0);
      return filteredUpstreamResponse(upstream);
    }

    const upstreamJson = await readJsonClone(upstream);
    if (!upstreamJson.ok) {
      await safeMarkUnknown(usageEventId);
      await cleanupReservation(auth.proxyKey.id, reservation, 0);
      return filteredUpstreamResponse(upstream);
    }

    const usage = extractTokenUsage(upstreamJson.value);
    const providerRequestId = extractProviderRequestId(upstreamJson.value);
    if (!usage) {
      await safeMarkUnknown(usageEventId, providerRequestId);
      await cleanupReservation(auth.proxyKey.id, reservation, 0);
      return filteredUpstreamResponse(upstream);
    }

    const priceResult = lookupModelPrice({
      prices: auth.policy.prices,
      provider: "openai",
      model: policyResult.model,
    });
    if (!priceResult.ok) {
      await safeMarkUnknown(usageEventId, providerRequestId);
      await cleanupReservation(auth.proxyKey.id, reservation, 0);
      return filteredUpstreamResponse(upstream);
    }

    const actualCostUsd = calculateTokenCostUsd({
      price: priceResult.price,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
    await safeMarkSucceeded(usageEventId, {
      actualCostUsd,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      rawUsage: usage.rawUsage,
      ...(providerRequestId ? { providerRequestId } : {}),
    });
    await cleanupReservation(auth.proxyKey.id, reservation, actualCostUsd);
    return filteredUpstreamResponse(upstream);
  } catch {
    await safeMarkFailed(usageEventId, "upstream_request_failed");
    if (reservation) {
      await cleanupReservation(auth.proxyKey.id, reservation, 0);
    }
    return proxyError(
      502,
      "upstream_request_failed",
      "OpenAI proxy request failed."
    );
  }
}

function proxyError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

function filteredUpstreamResponse(upstream: Response): Response {
  const headers = new Headers();
  for (const header of SAFE_UPSTREAM_RESPONSE_HEADERS) {
    const value = upstream.headers.get(header);
    if (value !== null) {
      headers.set(header, value);
    }
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

async function cleanupReservation(
  proxyKeyId: string,
  reservation: ReservationState,
  actualCostUsd: number
): Promise<void> {
  await Promise.allSettled([
    safeCleanupStep("release_concurrency", () =>
      releaseConcurrency({
        reservationId: reservation.reservationId,
        proxyKeyId,
      })
    ),
    safeCleanupStep("refund_reservation", () =>
      refundReservation({
        reservationId: reservation.reservationId,
        proxyKeyId,
        actualCostUsd,
        reservedMicroUsd: reservation.reservedMicroUsd,
      })
    ),
  ]);
}

async function safeMarkSucceeded(
  usageEventId: string | null,
  input: {
    actualCostUsd: number;
    inputTokens: number;
    outputTokens: number;
    rawUsage: unknown;
    providerRequestId?: string;
  }
): Promise<void> {
  if (!usageEventId) {
    return;
  }

  try {
    await markUsageSucceeded({ usageEventId, ...input });
  } catch (error) {
    logProxySideEffectFailure("mark_usage_succeeded", error);
  }
}

async function safeMarkFailed(
  usageEventId: string | null,
  errorCode: string
): Promise<void> {
  if (!usageEventId) {
    return;
  }

  try {
    await markUsageFailed({ usageEventId, errorCode });
  } catch (error) {
    logProxySideEffectFailure("mark_usage_failed", error);
  }
}

async function safeMarkUnknown(
  usageEventId: string | null,
  providerRequestId?: string
): Promise<void> {
  if (!usageEventId) {
    return;
  }

  try {
    await markUsageUnknown({
      usageEventId,
      ...(providerRequestId ? { providerRequestId } : {}),
    });
  } catch (error) {
    logProxySideEffectFailure("mark_usage_unknown", error);
  }
}

async function safeCleanupStep(
  operation: string,
  cleanup: () => Promise<void>
): Promise<void> {
  try {
    await cleanup();
  } catch (error) {
    logProxySideEffectFailure(operation, error);
  }
}

function logProxySideEffectFailure(operation: string, error: unknown): void {
  console.error("OpenAI proxy side effect failed", {
    operation,
    errorName: error instanceof Error ? error.name : typeof error,
  });
}

async function extractUpstreamErrorCode(response: Response): Promise<string> {
  const json = await readJsonClone(response);
  if (json.ok && isRecord(json.value) && isRecord(json.value.error)) {
    const code = json.value.error.code ?? json.value.error.type;
    if (typeof code === "string" && code.length > 0) {
      return code;
    }
  }

  return `openai_${response.status}`;
}

async function readJsonClone(
  response: Response
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await response.clone().json() };
  } catch {
    return { ok: false };
  }
}

function extractTokenUsage(value: unknown): TokenUsage | null {
  if (!isRecord(value) || !isRecord(value.usage)) {
    return null;
  }

  const inputTokens = readTokenCount(
    value.usage.input_tokens,
    value.usage.prompt_tokens
  );
  const outputTokens = readTokenCount(
    value.usage.output_tokens,
    value.usage.completion_tokens
  );

  if (inputTokens === null || outputTokens === null) {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
    rawUsage: value.usage,
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

function extractProviderRequestId(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return typeof value.id === "string" && value.id.length > 0
    ? value.id
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

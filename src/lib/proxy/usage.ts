import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { proxyKeys, proxyUsageEvents } from "@/db/schema";

type UsageEventUpdate = Partial<typeof proxyUsageEvents.$inferInsert>;
type TerminalUsageEventUpdate = {
  status: "succeeded" | "failed" | "usage_unknown";
  actualCostUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  rawUsage?: unknown;
  errorCode?: string;
  providerRequestId?: string;
  completedAt?: Date;
};

export async function createReservedUsageEvent(input: {
  proxyKeyId: string;
  userId: string;
  provider: "openai";
  endpoint: "responses" | "chat_completions";
  model: string;
  estimatedCostUsd: number;
  reservedCostUsd: number;
  requestId: string;
}): Promise<string> {
  const usageEventId = randomUUID();
  const now = new Date().toISOString();

  await db.insert(proxyUsageEvents).values({
    id: usageEventId,
    proxyKeyId: input.proxyKeyId,
    userId: input.userId,
    provider: input.provider,
    endpoint: input.endpoint,
    model: input.model,
    status: "reserved",
    requestId: input.requestId,
    estimatedCostUsd: input.estimatedCostUsd,
    reservedCostUsd: input.reservedCostUsd,
  }).run();
  await updateProxyKeyLastUsed(input.proxyKeyId, now);

  return usageEventId;
}

export async function markUsageSucceeded(input: {
  usageEventId: string;
  actualCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  rawUsage: unknown;
  providerRequestId?: string;
  completedAt?: Date;
}): Promise<void> {
  await markUsageEvent(input.usageEventId, {
    status: "succeeded",
    actualCostUsd: input.actualCostUsd,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    rawUsage: input.rawUsage,
    providerRequestId: input.providerRequestId,
    completedAt: input.completedAt,
  });
}

export async function markUsageFailed(input: {
  usageEventId: string;
  errorCode: string;
  providerRequestId?: string;
  completedAt?: Date;
}): Promise<void> {
  await markUsageEvent(input.usageEventId, {
    status: "failed",
    errorCode: input.errorCode,
    providerRequestId: input.providerRequestId,
    completedAt: input.completedAt,
  });
}

export async function markUsageUnknown(input: {
  usageEventId: string;
  providerRequestId?: string;
  completedAt?: Date;
}): Promise<void> {
  await markUsageEvent(input.usageEventId, {
    status: "usage_unknown",
    providerRequestId: input.providerRequestId,
    completedAt: input.completedAt,
  });
}

async function markUsageEvent(
  usageEventId: string,
  input: TerminalUsageEventUpdate
): Promise<void> {
  const existingEvent = await db
    .select({
      proxyKeyId: proxyUsageEvents.proxyKeyId,
      status: proxyUsageEvents.status,
    })
    .from(proxyUsageEvents)
    .where(eq(proxyUsageEvents.id, usageEventId))
    .get();

  if (!existingEvent || existingEvent.status !== "reserved") {
    return;
  }

  const nowDate = new Date();
  const completedAt = (input.completedAt ?? nowDate).toISOString();
  const update: UsageEventUpdate = {
    status: input.status,
    actualCostUsd: input.actualCostUsd,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    errorCode: input.errorCode,
    completedAt,
  };

  if (input.status === "succeeded") {
    update.rawUsageJson = safeStringifyRawUsage(input.rawUsage);
  }

  if (input.providerRequestId !== undefined) {
    update.providerRequestId = input.providerRequestId;
  }

  const updatedEvent = await db
    .update(proxyUsageEvents)
    .set(update)
    .where(
      and(
        eq(proxyUsageEvents.id, usageEventId),
        eq(proxyUsageEvents.status, "reserved")
      )
    )
    .returning({ proxyKeyId: proxyUsageEvents.proxyKeyId })
    .get();

  if (!updatedEvent) {
    return;
  }

  await updateProxyKeyLastUsed(updatedEvent.proxyKeyId, completedAt);
}

function safeStringifyRawUsage(rawUsage: unknown): string | null {
  try {
    const serialized = JSON.stringify(rawUsage);
    return typeof serialized === "string" ? serialized : null;
  } catch {
    return null;
  }
}

async function updateProxyKeyLastUsed(
  proxyKeyId: string,
  lastUsedAt: string
): Promise<void> {
  await db
    .update(proxyKeys)
    .set({ lastUsedAt })
    .where(eq(proxyKeys.id, proxyKeyId))
    .run();
}

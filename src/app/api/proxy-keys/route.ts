import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { proxyKeyPolicies, proxyKeys } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  createProxyKeySecret,
  hashProxyKeySecret,
  keyHint,
} from "@/lib/proxy/key";

const createProxyKeySchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9_-]+$/, "Name may only contain letters, numbers, hyphens, and underscores"),
    allowedModels: z.array(z.string().min(1)).nonempty(),
    hourlyLimitUsd: z.number().positive(),
    dailyLimitUsd: z.number().positive(),
    monthlyLimitUsd: z.number().positive(),
    maxRequestUsd: z.number().positive(),
    maxOutputTokens: z.number().int().positive(),
    maxConcurrency: z.number().int().min(1).max(10),
  })
  .refine((data) => data.hourlyLimitUsd <= data.dailyLimitUsd, {
    path: ["dailyLimitUsd"],
  })
  .refine((data) => data.dailyLimitUsd <= data.monthlyLimitUsd, {
    path: ["monthlyLimitUsd"],
  });

type PolicySummaryInput = {
  provider: "openai" | "anthropic" | "gemini";
  allowedModelsJson: string;
  hourlyLimitUsd: number;
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
  maxRequestUsd: number;
  maxOutputTokens: number;
  maxConcurrency: number;
  allowTools: number;
};

type CreateProxyKeyInput = z.infer<typeof createProxyKeySchema>;
type MaybePromise<T> = T | Promise<T>;
type TransactionRunner = {
  transaction<T>(
    transaction: (tx: unknown) => MaybePromise<T>,
    config?: { behavior?: "deferred" | "immediate" | "exclusive" }
  ): MaybePromise<T>;
};
type ProxyKeyResponseInput = Parameters<typeof proxyKeyResponse>[0];
type CreateProxyKeyResult = {
  newKey: ProxyKeyResponseInput;
  newPolicy: PolicySummaryInput;
};

class DuplicateProxyKeyNameError extends Error {}

function isPromiseLike<T>(value: MaybePromise<T>): value is Promise<T> {
  return typeof (value as { then?: unknown }).then === "function";
}

function chainMaybePromise<T, U>(
  value: MaybePromise<T>,
  next: (value: T) => MaybePromise<U>
): MaybePromise<U> {
  return isPromiseLike(value) ? value.then(next) : next(value);
}

function policySummary(policy: PolicySummaryInput) {
  return {
    provider: policy.provider,
    allowedModels: JSON.parse(policy.allowedModelsJson) as string[],
    hourlyLimitUsd: policy.hourlyLimitUsd,
    dailyLimitUsd: policy.dailyLimitUsd,
    monthlyLimitUsd: policy.monthlyLimitUsd,
    maxRequestUsd: policy.maxRequestUsd,
    maxOutputTokens: policy.maxOutputTokens,
    maxConcurrency: policy.maxConcurrency,
    allowTools: policy.allowTools === 1,
  };
}

function proxyKeyResponse(
  key: {
    id: string;
    name: string;
    keyHint: string;
    status: "active" | "revoked";
    createdAt: string;
    revokedAt: string | null;
    lastUsedAt: string | null;
  },
  policy: PolicySummaryInput
) {
  return {
    id: key.id,
    name: key.name,
    keyHint: key.keyHint,
    status: key.status,
    createdAt: key.createdAt,
    revokedAt: key.revokedAt,
    lastUsedAt: key.lastUsedAt,
    policy: policySummary(policy),
  };
}

function createProxyKeyInTransaction(
  tx: unknown,
  userId: string,
  data: CreateProxyKeyInput,
  secret: string
): MaybePromise<CreateProxyKeyResult> {
  const txDb = tx as typeof db;
  const existingResult = txDb
    .select({ id: proxyKeys.id })
    .from(proxyKeys)
    .where(
      and(
        eq(proxyKeys.userId, userId),
        eq(proxyKeys.name, data.name),
        eq(proxyKeys.status, "active")
      )
    )
    .all() as unknown as MaybePromise<Array<{ id: string }>>;

  return chainMaybePromise(existingResult, (existing) => {
    if (existing.length > 0) {
      throw new DuplicateProxyKeyNameError();
    }

    const newKeyResult = txDb
      .insert(proxyKeys)
      .values({
        userId,
        name: data.name,
        keyHash: hashProxyKeySecret(secret),
        keyHint: keyHint(secret),
        status: "active",
      })
      .returning()
      .get() as unknown as MaybePromise<ProxyKeyResponseInput>;

    return chainMaybePromise(newKeyResult, (newKey) => {
      const newPolicyResult = txDb
        .insert(proxyKeyPolicies)
        .values({
          proxyKeyId: newKey.id,
          provider: "openai",
          allowedModelsJson: JSON.stringify(data.allowedModels),
          hourlyLimitUsd: data.hourlyLimitUsd,
          dailyLimitUsd: data.dailyLimitUsd,
          monthlyLimitUsd: data.monthlyLimitUsd,
          maxRequestUsd: data.maxRequestUsd,
          maxOutputTokens: data.maxOutputTokens,
          maxConcurrency: data.maxConcurrency,
          allowTools: 0,
        })
        .returning()
        .get() as unknown as MaybePromise<PolicySummaryInput>;

      return chainMaybePromise(newPolicyResult, (newPolicy) => ({
        newKey,
        newPolicy,
      }));
    });
  });
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select({
      id: proxyKeys.id,
      name: proxyKeys.name,
      keyHint: proxyKeys.keyHint,
      status: proxyKeys.status,
      createdAt: proxyKeys.createdAt,
      revokedAt: proxyKeys.revokedAt,
      lastUsedAt: proxyKeys.lastUsedAt,
      provider: proxyKeyPolicies.provider,
      allowedModelsJson: proxyKeyPolicies.allowedModelsJson,
      hourlyLimitUsd: proxyKeyPolicies.hourlyLimitUsd,
      dailyLimitUsd: proxyKeyPolicies.dailyLimitUsd,
      monthlyLimitUsd: proxyKeyPolicies.monthlyLimitUsd,
      maxRequestUsd: proxyKeyPolicies.maxRequestUsd,
      maxOutputTokens: proxyKeyPolicies.maxOutputTokens,
      maxConcurrency: proxyKeyPolicies.maxConcurrency,
      allowTools: proxyKeyPolicies.allowTools,
    })
    .from(proxyKeys)
    .innerJoin(
      proxyKeyPolicies,
      eq(proxyKeyPolicies.proxyKeyId, proxyKeys.id)
    )
    .where(eq(proxyKeys.userId, session.user.id))
    .all();

  return NextResponse.json({
    data: rows.map((row) =>
      proxyKeyResponse(row, {
        provider: row.provider,
        allowedModelsJson: row.allowedModelsJson,
        hourlyLimitUsd: row.hourlyLimitUsd,
        dailyLimitUsd: row.dailyLimitUsd,
        monthlyLimitUsd: row.monthlyLimitUsd,
        maxRequestUsd: row.maxRequestUsd,
        maxOutputTokens: row.maxOutputTokens,
        maxConcurrency: row.maxConcurrency,
        allowTools: row.allowTools,
      })
    ),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const parsed = createProxyKeySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const secret = createProxyKeySecret();

  try {
    const { newKey, newPolicy } = await (db as unknown as TransactionRunner)
      .transaction(
        (tx) => createProxyKeyInTransaction(
          tx,
          session.user.id,
          parsed.data,
          secret
        ),
        { behavior: "immediate" }
      );

    const res = NextResponse.json({
      data: proxyKeyResponse(newKey, newPolicy),
      key: secret,
    });
    res.headers.set("Cache-Control", "no-store, no-cache");
    res.headers.set("Pragma", "no-cache");
    return res;
  } catch (error) {
    if (error instanceof DuplicateProxyKeyNameError) {
      return NextResponse.json(
        { error: `An active proxy key with name "${parsed.data.name}" already exists` },
        { status: 409 }
      );
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Proxy key creation failed:", message);
    return NextResponse.json(
      { error: "Failed to create proxy key" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  proxyBudgetReservations,
  proxyKeyPolicies,
  proxyKeys,
  users,
} from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { encrypt } from "@/lib/crypto";
import * as openai from "@/lib/providers/openai";
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
type ProxyBudgetReservation = typeof proxyBudgetReservations.$inferSelect;
type UpstreamCredentialInput = {
  upstreamProjectId: string;
  upstreamProviderKeyId: string;
  upstreamKeyValue: string;
  upstreamKeyHint: string;
};
type MaybePromise<T> = T | Promise<T>;
type TransactionRunner = {
  transaction<T>(
    transaction: (tx: unknown) => MaybePromise<T>,
    config?: { behavior?: "deferred" | "immediate" | "exclusive" }
  ): MaybePromise<T>;
};
type ProxyKeyResponseInput = Parameters<typeof proxyKeyResponse>[0];
type ThrottleSummary = {
  throttled: boolean;
  reason:
    | "hourly_budget_exceeded"
    | "daily_budget_exceeded"
    | "monthly_budget_exceeded"
    | null;
};
type BudgetWindowUsage = {
  usedUsd: number;
  limitUsd: number;
  percent: number;
  exceeded: boolean;
};
type BudgetUsage = {
  hour: BudgetWindowUsage;
  day: BudgetWindowUsage;
  month: BudgetWindowUsage;
};
type BudgetState = {
  throttle: ThrottleSummary;
  budgetUsage: BudgetUsage;
};
type CreateProxyKeyResult = {
  newKey: ProxyKeyResponseInput;
  newPolicy: PolicySummaryInput;
};

class DuplicateProxyKeyNameError extends Error {}

const MICRO_USD_PER_USD = 1_000_000;

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

function budgetState(
  policy: Pick<
    PolicySummaryInput,
    "hourlyLimitUsd" | "dailyLimitUsd" | "monthlyLimitUsd"
  >,
  reservations: ProxyBudgetReservation[],
  windows: ReturnType<typeof formatWindows>
): BudgetState {
  const budgetUsage = {
    hour: budgetWindowUsage(
      usedForWindow(reservations, "hourWindow", windows.hour),
      policy.hourlyLimitUsd
    ),
    day: budgetWindowUsage(
      usedForWindow(reservations, "dayWindow", windows.day),
      policy.dailyLimitUsd
    ),
    month: budgetWindowUsage(
      usedForWindow(reservations, "monthWindow", windows.month),
      policy.monthlyLimitUsd
    ),
  };

  if (budgetUsage.hour.exceeded) {
    return {
      throttle: { throttled: true, reason: "hourly_budget_exceeded" },
      budgetUsage,
    };
  }
  if (budgetUsage.day.exceeded) {
    return {
      throttle: { throttled: true, reason: "daily_budget_exceeded" },
      budgetUsage,
    };
  }
  if (budgetUsage.month.exceeded) {
    return {
      throttle: { throttled: true, reason: "monthly_budget_exceeded" },
      budgetUsage,
    };
  }

  return {
    throttle: { throttled: false, reason: null },
    budgetUsage,
  };
}

function budgetWindowUsage(
  usedMicroUsd: number,
  limitUsd: number
): BudgetWindowUsage {
  const usedUsd = usedMicroUsd / MICRO_USD_PER_USD;
  return {
    usedUsd,
    limitUsd,
    percent: limitUsd > 0 ? (usedUsd / limitUsd) * 100 : 0,
    exceeded: usedMicroUsd >= usdToMicroUsd(limitUsd),
  };
}

function usedForWindow(
  reservations: ProxyBudgetReservation[],
  field: "hourWindow" | "dayWindow" | "monthWindow",
  window: string
): number {
  return reservations
    .filter((reservation) => reservation[field] === window)
    .reduce((total, reservation) => total + billableMicroUsd(reservation), 0);
}

function billableMicroUsd(reservation: ProxyBudgetReservation): number {
  if (reservation.reconciled === 1 && reservation.actualMicroUsd !== null) {
    return reservation.actualMicroUsd;
  }
  return reservation.reservedMicroUsd;
}

function usdToMicroUsd(usd: number): number {
  return Math.ceil(usd * MICRO_USD_PER_USD);
}

function formatWindows(now: Date) {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const hour = String(now.getUTCHours()).padStart(2, "0");
  return {
    hour: `${year}${month}${day}${hour}`,
    day: `${year}${month}${day}`,
    month: `${year}${month}`,
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
  policy: PolicySummaryInput,
  budget: BudgetState = {
    throttle: { throttled: false, reason: null },
    budgetUsage: {
      hour: { usedUsd: 0, limitUsd: policy.hourlyLimitUsd, percent: 0, exceeded: false },
      day: { usedUsd: 0, limitUsd: policy.dailyLimitUsd, percent: 0, exceeded: false },
      month: { usedUsd: 0, limitUsd: policy.monthlyLimitUsd, percent: 0, exceeded: false },
    },
  }
) {
  return {
    id: key.id,
    name: key.name,
    keyHint: key.keyHint,
    status: key.status,
    createdAt: key.createdAt,
    revokedAt: key.revokedAt,
    lastUsedAt: key.lastUsedAt,
    throttle: budget.throttle,
    budgetUsage: budget.budgetUsage,
    policy: policySummary(policy),
  };
}

function createProxyKeyInTransaction(
  tx: unknown,
  userId: string,
  data: CreateProxyKeyInput,
  secret: string,
  upstream: UpstreamCredentialInput
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
        upstreamProjectId: upstream.upstreamProjectId,
        upstreamProviderKeyId: upstream.upstreamProviderKeyId,
        upstreamKeyValue: upstream.upstreamKeyValue,
        upstreamKeyHint: upstream.upstreamKeyHint,
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

async function getOrCreateOpenAIProject(
  userId: string,
  email: string
): Promise<string> {
  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .get();

  if (user?.openaiProjectId) {
    return user.openaiProjectId;
  }

  const project = await openai.createProject(`aikeyhive-${email}`);
  await db
    .update(users)
    .set({ openaiProjectId: project.id })
    .where(eq(users.id, userId))
    .run();

  return project.id;
}

async function cleanupCreatedUpstreamCredential(input: {
  projectId: string | null;
  serviceAccountId: string | null;
}): Promise<void> {
  if (!input.projectId || !input.serviceAccountId) {
    return;
  }

  try {
    await openai.deleteServiceAccount(input.projectId, input.serviceAccountId);
  } catch (error) {
    console.error(
      "OpenAI proxy upstream credential cleanup failed:",
      error instanceof Error ? error.message : error
    );
  }
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

  const reservations = rows.length === 0
    ? []
    : await db
        .select()
        .from(proxyBudgetReservations)
        .where(
          inArray(
            proxyBudgetReservations.proxyKeyId,
            rows.map((row) => row.id)
          )
        )
        .all();
  const windows = formatWindows(new Date());

  return NextResponse.json({
    data: rows.map((row) => {
      const policy = {
        provider: row.provider,
        allowedModelsJson: row.allowedModelsJson,
        hourlyLimitUsd: row.hourlyLimitUsd,
        dailyLimitUsd: row.dailyLimitUsd,
        monthlyLimitUsd: row.monthlyLimitUsd,
        maxRequestUsd: row.maxRequestUsd,
        maxOutputTokens: row.maxOutputTokens,
        maxConcurrency: row.maxConcurrency,
        allowTools: row.allowTools,
      };
      return proxyKeyResponse(
        row,
        policy,
        budgetState(
          policy,
          reservations.filter((reservation) => reservation.proxyKeyId === row.id),
          windows
        )
      );
    }),
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
  const existingActive = await db
    .select({ id: proxyKeys.id })
    .from(proxyKeys)
    .where(
      and(
        eq(proxyKeys.userId, session.user.id),
        eq(proxyKeys.name, parsed.data.name),
        eq(proxyKeys.status, "active")
      )
    )
    .all();

  if (existingActive.length > 0) {
    return NextResponse.json(
      { error: `An active proxy key with name "${parsed.data.name}" already exists` },
      { status: 409 }
    );
  }

  let createdProjectId: string | null = null;
  let createdServiceAccountId: string | null = null;

  try {
    const projectId = await getOrCreateOpenAIProject(
      session.user.id,
      session.user.email!
    );
    const serviceAccount = await openai.createServiceAccountKey(
      projectId,
      parsed.data.name
    );
    createdProjectId = projectId;
    createdServiceAccountId = serviceAccount.id;

    const upstream: UpstreamCredentialInput = {
      upstreamProjectId: projectId,
      upstreamProviderKeyId: serviceAccount.id,
      upstreamKeyValue: encrypt(serviceAccount.api_key.value),
      upstreamKeyHint: `sk-...${serviceAccount.api_key.value.slice(-4)}`,
    };

    const { newKey, newPolicy } = await (db as unknown as TransactionRunner)
      .transaction(
        (tx) => createProxyKeyInTransaction(
          tx,
          session.user.id,
          parsed.data,
          secret,
          upstream
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
    await cleanupCreatedUpstreamCredential({
      projectId: createdProjectId,
      serviceAccountId: createdServiceAccountId,
    });

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

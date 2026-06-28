"use client";

import useSWR from "swr";
import type { ApiKey } from "@/db/schema";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function errorMessageFromBody(body: unknown) {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string"
  ) {
    return body.error;
  }
  return "Failed to load";
}

async function throwingJsonFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    throw new Error(errorMessageFromBody(body));
  }

  return body as T;
}

export type DashboardKey = Pick<
  ApiKey,
  "id" | "provider" | "name" | "keyHint" | "createdAt"
> & { lastUsedAt: string | null };

export type DashboardProxyKey = {
  id: string;
  name: string;
  keyHint: string;
  status: "active" | "revoked";
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  throttle: {
    throttled: boolean;
    reason:
      | "hourly_budget_exceeded"
      | "daily_budget_exceeded"
      | "monthly_budget_exceeded"
      | null;
  };
  budgetUsage: {
    hour: {
      usedUsd: number;
      limitUsd: number;
      percent: number;
      exceeded: boolean;
    };
    day: {
      usedUsd: number;
      limitUsd: number;
      percent: number;
      exceeded: boolean;
    };
    month: {
      usedUsd: number;
      limitUsd: number;
      percent: number;
      exceeded: boolean;
    };
  };
  policy: {
    provider: "openai" | "anthropic" | "gemini";
    allowedModels: string[];
    hourlyLimitUsd: number;
    dailyLimitUsd: number;
    monthlyLimitUsd: number;
    maxRequestUsd: number;
    maxOutputTokens: number;
    maxConcurrency: number;
    allowTools: boolean;
  };
};

export function useKeys() {
  const { data, error, isLoading, mutate } = useSWR<{ data: DashboardKey[] }>(
    "/api/keys",
    fetcher
  );

  return {
    keys: data?.data || [],
    isLoading,
    isError: !!error,
    mutate,
  };
}

export function useProxyKeys() {
  const { data, error, isLoading, mutate } = useSWR<{
    data: DashboardProxyKey[];
  }>("/api/proxy-keys", throwingJsonFetcher);

  return {
    keys: data?.data || [],
    isLoading,
    isError: !!error,
    error: error instanceof Error ? error.message : null,
    mutate,
  };
}

export function useCosts(params?: {
  start?: string;
  end?: string;
  groupBy?: string;
}) {
  const searchParams = new URLSearchParams();
  if (params?.start) searchParams.set("start", params.start);
  if (params?.end) searchParams.set("end", params.end);
  if (params?.groupBy) searchParams.set("groupBy", params.groupBy);

  const url = `/api/costs?${searchParams.toString()}`;
  const { data, error, isLoading } = useSWR(url, fetcher);

  return {
    costs: data?.data || [],
    isLoading,
    isError: !!error,
  };
}

export function useAdminUsers() {
  const { data, error, isLoading, mutate } = useSWR(
    "/api/admin/users",
    fetcher
  );

  return {
    users: data?.data || [],
    isLoading,
    isError: !!error,
    mutate,
  };
}

export function useAdminPool() {
  const { data, error, isLoading, mutate } = useSWR(
    "/api/admin/pool",
    fetcher
  );

  return {
    pool: data?.data || [],
    isLoading,
    isError: !!error,
    mutate,
  };
}

export function useAdminProviderKeys(provider: "openai" | "anthropic" | "gemini") {
  const { data, error, isLoading, mutate } = useSWR(
    `/api/admin/provider-keys/${provider}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  return {
    keys: data?.data || [],
    error: data?.error || (error ? "Failed to load" : null),
    isLoading,
    mutate,
  };
}

export function useAdminBudgets() {
  const { data, error, isLoading, mutate } = useSWR(
    "/api/admin/budgets",
    fetcher
  );

  return {
    budgets: data?.data || [],
    isLoading,
    isError: !!error,
    mutate,
  };
}

"use client";

import useSWR from "swr";
import type { ApiKey } from "@/db/schema";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useKeys() {
  const { data, error, isLoading, mutate } = useSWR<{ data: ApiKey[] }>(
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

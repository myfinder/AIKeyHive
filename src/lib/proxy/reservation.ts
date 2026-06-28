import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { proxyBudgetReservations } from "@/db/schema";

const MICRO_USD_PER_USD = 1_000_000;

type ReservationDatabase = typeof db;
type ReservationRow = typeof proxyBudgetReservations.$inferSelect;
type MaybePromise<T> = T | Promise<T>;
type TransactionRunner = {
  transaction<T>(
    transaction: (tx: ReservationDatabase) => MaybePromise<T>,
    config?: { behavior?: "deferred" | "immediate" | "exclusive" }
  ): MaybePromise<T>;
};

export type ReservationResult =
  | { ok: true; reservationId: string; reservedMicroUsd: number }
  | { ok: false; status: 429 | 503; code: string; message: string };

function isPromiseLike<T>(value: MaybePromise<T>): value is Promise<T> {
  return typeof (value as { then?: unknown }).then === "function";
}

function chainMaybePromise<T, U>(
  value: MaybePromise<T>,
  next: (value: T) => MaybePromise<U>
): MaybePromise<U> {
  return isPromiseLike(value) ? value.then(next) : next(value);
}

export async function reserveBudget(input: {
  database?: ReservationDatabase;
  proxyKeyId: string;
  estimatedCostUsd: number;
  hourlyLimitUsd: number;
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
  maxConcurrency: number;
  now?: Date;
  reservationId?: string;
}): Promise<ReservationResult> {
  const database = input.database ?? db;
  const now = input.now ?? new Date();
  const reservationId = input.reservationId ?? randomUUID();
  const reservedMicroUsd = usdToMicroUsd(input.estimatedCostUsd);
  const windows = formatWindows(now);

  try {
    return await runTransaction(database, (tx) => {
      const rowsResult = tx
        .select()
        .from(proxyBudgetReservations)
        .where(eq(proxyBudgetReservations.proxyKeyId, input.proxyKeyId))
        .all() as unknown as MaybePromise<ReservationRow[]>;

      return chainMaybePromise(rowsResult, (rows) => {
        if (rows.some((row) => row.id === reservationId)) {
          return unavailable();
        }

        if (
          usedForWindow(rows, "hourWindow", windows.hour) + reservedMicroUsd >
          usdToMicroUsd(input.hourlyLimitUsd)
        ) {
          return rejectionForCode("hourly_budget_exceeded");
        }

        if (
          usedForWindow(rows, "dayWindow", windows.day) + reservedMicroUsd >
          usdToMicroUsd(input.dailyLimitUsd)
        ) {
          return rejectionForCode("daily_budget_exceeded");
        }

        if (
          usedForWindow(rows, "monthWindow", windows.month) + reservedMicroUsd >
          usdToMicroUsd(input.monthlyLimitUsd)
        ) {
          return rejectionForCode("monthly_budget_exceeded");
        }

        const activeConcurrency = rows.filter((row) => row.released === 0).length;
        if (activeConcurrency + 1 > Math.floor(input.maxConcurrency)) {
          return rejectionForCode("concurrency_exceeded");
        }

        const insertResult = tx.insert(proxyBudgetReservations)
          .values({
            id: reservationId,
            proxyKeyId: input.proxyKeyId,
            hourWindow: windows.hour,
            dayWindow: windows.day,
            monthWindow: windows.month,
            reservedMicroUsd,
            released: 0,
            reconciled: 0,
          })
          .run() as unknown as MaybePromise<unknown>;

        return chainMaybePromise(insertResult, () => ({
          ok: true,
          reservationId,
          reservedMicroUsd,
        }));
      });
    });
  } catch {
    return unavailable();
  }
}

export async function releaseConcurrency(input: {
  database?: ReservationDatabase;
  reservationId: string;
  proxyKeyId?: string;
}): Promise<void> {
  const database = input.database ?? db;
  const existing = await (database
    .select()
    .from(proxyBudgetReservations)
    .where(eq(proxyBudgetReservations.id, input.reservationId))
    .get() as unknown as MaybePromise<ReservationRow | undefined>);

  if (!existing || existing.released === 1) {
    return;
  }

  await (database
    .update(proxyBudgetReservations)
    .set({
      released: 1,
      completedAt: existing.completedAt ?? new Date().toISOString(),
    })
    .where(eq(proxyBudgetReservations.id, input.reservationId))
    .run() as unknown as MaybePromise<unknown>);
}

export async function refundReservation(input: {
  database?: ReservationDatabase;
  reservationId: string;
  actualCostUsd: number;
  proxyKeyId?: string;
  reservedMicroUsd?: number;
  now?: Date;
}): Promise<void> {
  const database = input.database ?? db;
  const existing = await (database
    .select()
    .from(proxyBudgetReservations)
    .where(eq(proxyBudgetReservations.id, input.reservationId))
    .get() as unknown as MaybePromise<ReservationRow | undefined>);

  if (!existing || existing.reconciled === 1) {
    return;
  }

  await (database
    .update(proxyBudgetReservations)
    .set({
      actualMicroUsd: usdToMicroUsd(input.actualCostUsd),
      reconciled: 1,
      completedAt: existing.completedAt ?? (input.now ?? new Date()).toISOString(),
    })
    .where(eq(proxyBudgetReservations.id, input.reservationId))
    .run() as unknown as MaybePromise<unknown>);
}

async function runTransaction<T>(
  database: ReservationDatabase,
  transaction: (tx: ReservationDatabase) => MaybePromise<T>
): Promise<T> {
  const runner = database as unknown as TransactionRunner;
  return await runner.transaction(transaction, { behavior: "immediate" });
}

function usedForWindow(
  rows: ReservationRow[],
  field: "hourWindow" | "dayWindow" | "monthWindow",
  window: string
): number {
  return rows
    .filter((row) => row[field] === window)
    .reduce((total, row) => total + billableMicroUsd(row), 0);
}

function billableMicroUsd(row: ReservationRow): number {
  if (row.reconciled === 1 && row.actualMicroUsd !== null) {
    return row.actualMicroUsd;
  }
  return row.reservedMicroUsd;
}

function usdToMicroUsd(usd: number): number {
  return Math.ceil(usd * MICRO_USD_PER_USD);
}

function rejectionForCode(code: string): Extract<ReservationResult, { ok: false }> {
  switch (code) {
    case "hourly_budget_exceeded":
      return {
        ok: false,
        status: 429,
        code,
        message: "Hourly proxy budget would be exceeded.",
      };
    case "daily_budget_exceeded":
      return {
        ok: false,
        status: 429,
        code,
        message: "Daily proxy budget would be exceeded.",
      };
    case "monthly_budget_exceeded":
      return {
        ok: false,
        status: 429,
        code,
        message: "Monthly proxy budget would be exceeded.",
      };
    case "concurrency_exceeded":
      return {
        ok: false,
        status: 429,
        code,
        message: "Proxy key concurrency limit would be exceeded.",
      };
    default:
      return unavailable();
  }
}

function unavailable(): Extract<ReservationResult, { ok: false }> {
  return {
    ok: false,
    status: 503,
    code: "budget_reservation_unavailable",
    message: "Budget reservation service is unavailable.",
  };
}

function formatWindows(now: Date): {
  hour: string;
  day: string;
  month: string;
} {
  const year = String(now.getUTCFullYear());
  const month = pad2(now.getUTCMonth() + 1);
  const day = pad2(now.getUTCDate());
  const hour = pad2(now.getUTCHours());

  return {
    hour: `${year}${month}${day}${hour}`,
    day: `${year}${month}${day}`,
    month: `${year}${month}`,
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

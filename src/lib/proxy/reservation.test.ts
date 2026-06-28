import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedUser } from "@/__tests__/db-helper";
import { proxyBudgetReservations, proxyKeys } from "@/db/schema";
import {
  refundReservation,
  releaseConcurrency,
  reserveBudget,
} from "@/lib/proxy/reservation";

const testDbInstance = createTestDb();

const NOW = new Date("2026-06-07T08:09:10.000Z");
const NEXT_HOUR = new Date("2026-06-07T09:00:01.000Z");
const PROXY_KEY_ID = "proxy_key_123";
const RESERVATION_ID = "reservation_123";

function seedProxyKey(id = PROXY_KEY_ID) {
  seedUser(testDbInstance.db, {
    id: "user-1",
    oidcSub: "oidc-1",
    email: "user1@test.com",
  });
  testDbInstance.db
    .insert(proxyKeys)
    .values({
      id,
      userId: "user-1",
      name: "proxy",
      keyHash: `hash-${id}`,
      keyHint: "akp_...test",
      upstreamProjectId: "proj_123",
      upstreamProviderKeyId: "sa_123",
      upstreamKeyValue: "encrypted",
      upstreamKeyHint: "sk-...test",
    })
    .run();
}

function reserveInput(reservationId = RESERVATION_ID) {
  return {
    database: testDbInstance.db,
    proxyKeyId: PROXY_KEY_ID,
    estimatedCostUsd: 0.25,
    hourlyLimitUsd: 1,
    dailyLimitUsd: 5,
    monthlyLimitUsd: 50,
    maxConcurrency: 2,
    now: NOW,
    reservationId,
  };
}

function getReservation(id = RESERVATION_ID) {
  return testDbInstance.db
    .select()
    .from(proxyBudgetReservations)
    .where(eq(proxyBudgetReservations.id, id))
    .get();
}

function insertReservation(input: {
  id: string;
  reservedMicroUsd: number;
  hourWindow?: string;
  dayWindow?: string;
  monthWindow?: string;
  actualMicroUsd?: number | null;
  released?: number;
  reconciled?: number;
}) {
  testDbInstance.db
    .insert(proxyBudgetReservations)
    .values({
      proxyKeyId: PROXY_KEY_ID,
      hourWindow: input.hourWindow ?? "2026060708",
      dayWindow: input.dayWindow ?? "20260607",
      monthWindow: input.monthWindow ?? "202606",
      released: input.released ?? 1,
      reconciled: input.reconciled ?? 0,
      actualMicroUsd: input.actualMicroUsd ?? null,
      ...input,
    })
    .run();
}

describe("proxy budget reservations", () => {
  beforeEach(() => {
    testDbInstance.sqlite.exec("DELETE FROM proxy_budget_reservations");
    testDbInstance.sqlite.exec("DELETE FROM proxy_keys");
    testDbInstance.sqlite.exec("DELETE FROM users");
    seedProxyKey();
  });

  it("reserves when all budgets and concurrency have room", async () => {
    const result = await reserveBudget(reserveInput());

    expect(result).toEqual({
      ok: true,
      reservationId: RESERVATION_ID,
      reservedMicroUsd: 250_000,
    });
    expect(getReservation()).toMatchObject({
      id: RESERVATION_ID,
      proxyKeyId: PROXY_KEY_ID,
      hourWindow: "2026060708",
      dayWindow: "20260607",
      monthWindow: "202606",
      reservedMicroUsd: 250_000,
      actualMicroUsd: null,
      released: 0,
      reconciled: 0,
    });
  });

  it("rejects when the hourly budget would exceed", async () => {
    insertReservation({ id: "existing", reservedMicroUsd: 800_000 });

    const result = await reserveBudget(reserveInput());

    expect(result).toMatchObject({
      ok: false,
      status: 429,
      code: "hourly_budget_exceeded",
    });
    expect(getReservation()).toBeUndefined();
  });

  it("rejects when the daily budget would exceed", async () => {
    insertReservation({
      id: "existing",
      reservedMicroUsd: 4_900_000,
      hourWindow: "2026060707",
    });

    const result = await reserveBudget(reserveInput());

    expect(result).toMatchObject({
      ok: false,
      status: 429,
      code: "daily_budget_exceeded",
    });
    expect(getReservation()).toBeUndefined();
  });

  it("rejects when the monthly budget would exceed", async () => {
    insertReservation({
      id: "existing",
      reservedMicroUsd: 49_900_000,
      hourWindow: "2026060707",
      dayWindow: "20260606",
    });

    const result = await reserveBudget(reserveInput());

    expect(result).toMatchObject({
      ok: false,
      status: 429,
      code: "monthly_budget_exceeded",
    });
    expect(getReservation()).toBeUndefined();
  });

  it("rejects when concurrency would exceed", async () => {
    insertReservation({ id: "r1", reservedMicroUsd: 10_000, released: 0 });
    insertReservation({ id: "r2", reservedMicroUsd: 10_000, released: 0 });

    const result = await reserveBudget(reserveInput());

    expect(result).toMatchObject({
      ok: false,
      status: 429,
      code: "concurrency_exceeded",
    });
    expect(getReservation()).toBeUndefined();
  });

  it("fails closed when the reservation transaction is unavailable", async () => {
    const result = await reserveBudget({
      ...reserveInput(),
      database: {
        transaction: vi.fn(() => {
          throw new Error("database unavailable");
        }),
      } as never,
    });

    expect(result).toEqual({
      ok: false,
      status: 503,
      code: "budget_reservation_unavailable",
      message: "Budget reservation service is unavailable.",
    });
  });

  it("releases reservation concurrency on completion", async () => {
    await reserveBudget(reserveInput());

    await releaseConcurrency({
      database: testDbInstance.db,
      reservationId: RESERVATION_ID,
    });

    expect(getReservation()).toMatchObject({ released: 1 });
  });

  it("does not change state for duplicate release", async () => {
    await reserveBudget(reserveInput());
    await releaseConcurrency({
      database: testDbInstance.db,
      reservationId: RESERVATION_ID,
    });

    await releaseConcurrency({
      database: testDbInstance.db,
      reservationId: RESERVATION_ID,
    });

    expect(getReservation()).toMatchObject({ released: 1 });
  });

  it("uses actual cost for later budget checks after reconciliation", async () => {
    await reserveBudget(reserveInput());
    await refundReservation({
      database: testDbInstance.db,
      reservationId: RESERVATION_ID,
      actualCostUsd: 0.1,
    });

    const result = await reserveBudget(reserveInput("reservation_2"));

    expect(result).toMatchObject({ ok: true });
    expect(getReservation()).toMatchObject({
      actualMicroUsd: 100_000,
      reconciled: 1,
    });
  });

  it("does not reconcile budgets twice for duplicate refund", async () => {
    await reserveBudget(reserveInput());
    await refundReservation({
      database: testDbInstance.db,
      reservationId: RESERVATION_ID,
      actualCostUsd: 0.4,
    });
    await refundReservation({
      database: testDbInstance.db,
      reservationId: RESERVATION_ID,
      actualCostUsd: 0.1,
    });

    expect(getReservation()).toMatchObject({
      actualMicroUsd: 400_000,
      reconciled: 1,
    });
  });

  it("uses original reservation windows when refunding after an hour boundary", async () => {
    await reserveBudget(reserveInput());
    await refundReservation({
      database: testDbInstance.db,
      reservationId: RESERVATION_ID,
      actualCostUsd: 0.1,
      now: NEXT_HOUR,
    });

    expect(getReservation()).toMatchObject({
      hourWindow: "2026060708",
      actualMicroUsd: 100_000,
      reconciled: 1,
    });
  });
});

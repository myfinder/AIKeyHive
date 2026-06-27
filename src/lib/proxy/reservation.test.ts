import { afterEach, describe, expect, it, vi } from "vitest";
import {
  refundReservation,
  releaseConcurrency,
  reserveBudget,
  type RedisLike,
} from "@/lib/proxy/reservation";

const NOW = new Date("2026-06-07T08:09:10.000Z");
const PROXY_KEY_ID = "proxy_key_123";
const RESERVATION_ID = "reservation_123";

const hourKey = "proxy:budget:hour:proxy_key_123:2026060708";
const nextHourKey = "proxy:budget:hour:proxy_key_123:2026060709";
const dayKey = "proxy:budget:day:proxy_key_123:20260607";
const monthKey = "proxy:budget:month:proxy_key_123:202606";
const concurrencyKey = "proxy:concurrency:proxy_key_123";
const reservationKey = "proxy:reservation:reservation_123";

class FakeRedis implements RedisLike {
  readonly evalCalls: Array<{
    script: string;
    keys: string[];
    args: (string | number)[];
  }> = [];

  throwOnEval = false;

  private values = new Map<string, number>();
  private hashes = new Map<string, Record<string, string>>();

  get(key: string): number | undefined {
    return this.values.get(key);
  }

  hash(key: string): Record<string, string> | undefined {
    return this.hashes.get(key);
  }

  set(key: string, value: number): void {
    this.values.set(key, value);
  }

  async eval(
    script: string,
    keys: string[],
    args: (string | number)[]
  ): Promise<unknown> {
    this.evalCalls.push({ script, keys, args });

    if (this.throwOnEval) {
      throw new Error("redis unavailable");
    }

    if (keys.length === 5) {
      return this.reserve(keys, args);
    }

    if (keys.length === 1 && args.length === 0) {
      return this.release(keys[0]);
    }

    if (keys.length === 1 && args.length === 1) {
      return this.reconcile(keys[0], args);
    }

    throw new Error(`Unexpected eval call with ${keys.length} keys`);
  }

  private reserve(keys: string[], args: (string | number)[]): unknown {
    const reservedMicroUsd = Number(args[0]);
    const hourlyLimitMicroUsd = Number(args[1]);
    const dailyLimitMicroUsd = Number(args[2]);
    const monthlyLimitMicroUsd = Number(args[3]);
    const maxConcurrency = Number(args[4]);
    const proxyKeyId = String(args[10]);
    const [hour, day, month, concurrency, reservation] = keys;

    if (this.value(hour) + reservedMicroUsd > hourlyLimitMicroUsd) {
      return [0, "hourly_budget_exceeded"];
    }

    if (this.value(day) + reservedMicroUsd > dailyLimitMicroUsd) {
      return [0, "daily_budget_exceeded"];
    }

    if (this.value(month) + reservedMicroUsd > monthlyLimitMicroUsd) {
      return [0, "monthly_budget_exceeded"];
    }

    if (this.value(concurrency) + 1 > maxConcurrency) {
      return [0, "concurrency_exceeded"];
    }

    this.values.set(hour, this.value(hour) + reservedMicroUsd);
    this.values.set(day, this.value(day) + reservedMicroUsd);
    this.values.set(month, this.value(month) + reservedMicroUsd);
    this.values.set(concurrency, this.value(concurrency) + 1);
    this.hashes.set(reservation, {
      proxyKeyId,
      hourKey: hour,
      dayKey: day,
      monthKey: month,
      concurrencyKey: concurrency,
      reservedMicroUsd: String(reservedMicroUsd),
      released: "0",
      reconciled: "0",
    });

    return [1, "reserved"];
  }

  private release(reservationKey: string): unknown {
    const reservation = this.hashes.get(reservationKey);
    if (!reservation || reservation.released === "1") {
      return 0;
    }

    const key = reservation.concurrencyKey;
    const nextValue = Math.max(0, this.value(key) - 1);
    if (nextValue === 0) {
      this.values.delete(key);
    } else {
      this.values.set(key, nextValue);
    }
    reservation.released = "1";

    return nextValue;
  }

  private reconcile(
    reservationKey: string,
    args: (string | number)[]
  ): unknown {
    const reservation = this.hashes.get(reservationKey);
    if (!reservation || reservation.reconciled === "1") {
      return [1, "noop"];
    }

    const actualMicroUsd = Number(args[0]);
    const reservedMicroUsd = Number(reservation.reservedMicroUsd);
    const deltaMicroUsd = actualMicroUsd - reservedMicroUsd;
    const keys = [
      reservation.hourKey,
      reservation.dayKey,
      reservation.monthKey,
    ];

    if (deltaMicroUsd < 0) {
      for (const key of keys) {
        this.decrementWithoutGoingBelowZero(key, Math.abs(deltaMicroUsd));
      }
    } else if (deltaMicroUsd > 0) {
      for (const key of keys) {
        this.values.set(key, this.value(key) + deltaMicroUsd);
      }
    }

    reservation.reconciled = "1";
    return [1, "reconciled"];
  }

  private decrementWithoutGoingBelowZero(key: string, amount: number): void {
    const nextValue = Math.max(0, this.value(key) - amount);
    if (nextValue === 0) {
      this.values.delete(key);
    } else {
      this.values.set(key, nextValue);
    }
  }

  private value(key: string): number {
    return this.values.get(key) ?? 0;
  }
}

function reserveInput(redis: RedisLike, reservationId = RESERVATION_ID) {
  return {
    redis,
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

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy budget reservations", () => {
  it("reserves when all budgets and concurrency have room", async () => {
    const redis = new FakeRedis();

    const result = await reserveBudget(reserveInput(redis));

    expect(result).toEqual({
      ok: true,
      reservationId: RESERVATION_ID,
      reservedMicroUsd: 250_000,
    });
    expect(redis.get(hourKey)).toBe(250_000);
    expect(redis.get(dayKey)).toBe(250_000);
    expect(redis.get(monthKey)).toBe(250_000);
    expect(redis.get(concurrencyKey)).toBe(1);
    expect(redis.hash(reservationKey)).toMatchObject({
      proxyKeyId: PROXY_KEY_ID,
      hourKey,
      dayKey,
      monthKey,
      concurrencyKey,
      reservedMicroUsd: "250000",
      released: "0",
      reconciled: "0",
    });
  });

  it("rejects when the hourly budget would exceed", async () => {
    const redis = new FakeRedis();
    redis.set(hourKey, 800_000);

    const result = await reserveBudget(reserveInput(redis));

    expect(result).toMatchObject({
      ok: false,
      status: 429,
      code: "hourly_budget_exceeded",
    });
    expect(redis.get(hourKey)).toBe(800_000);
    expect(redis.get(concurrencyKey)).toBeUndefined();
    expect(redis.hash(reservationKey)).toBeUndefined();
  });

  it("rejects when the daily budget would exceed", async () => {
    const redis = new FakeRedis();
    redis.set(dayKey, 4_900_000);

    const result = await reserveBudget(reserveInput(redis));

    expect(result).toMatchObject({
      ok: false,
      status: 429,
      code: "daily_budget_exceeded",
    });
    expect(redis.get(dayKey)).toBe(4_900_000);
    expect(redis.get(concurrencyKey)).toBeUndefined();
    expect(redis.hash(reservationKey)).toBeUndefined();
  });

  it("rejects when the monthly budget would exceed", async () => {
    const redis = new FakeRedis();
    redis.set(monthKey, 49_900_000);

    const result = await reserveBudget(reserveInput(redis));

    expect(result).toMatchObject({
      ok: false,
      status: 429,
      code: "monthly_budget_exceeded",
    });
    expect(redis.get(monthKey)).toBe(49_900_000);
    expect(redis.get(concurrencyKey)).toBeUndefined();
    expect(redis.hash(reservationKey)).toBeUndefined();
  });

  it("rejects when concurrency would exceed", async () => {
    const redis = new FakeRedis();
    redis.set(concurrencyKey, 2);

    const result = await reserveBudget(reserveInput(redis));

    expect(result).toMatchObject({
      ok: false,
      status: 429,
      code: "concurrency_exceeded",
    });
    expect(redis.get(hourKey)).toBeUndefined();
    expect(redis.get(dayKey)).toBeUndefined();
    expect(redis.get(monthKey)).toBeUndefined();
    expect(redis.get(concurrencyKey)).toBe(2);
    expect(redis.hash(reservationKey)).toBeUndefined();
  });

  it("releases reservation concurrency on completion", async () => {
    const redis = new FakeRedis();
    await reserveBudget(reserveInput(redis));

    await releaseConcurrency({ redis, reservationId: RESERVATION_ID });

    expect(redis.get(concurrencyKey)).toBeUndefined();
    expect(redis.hash(reservationKey)).toMatchObject({ released: "1" });
  });

  it("does not decrement concurrency twice for duplicate release", async () => {
    const redis = new FakeRedis();
    await reserveBudget(reserveInput(redis, "reservation_1"));
    await reserveBudget(reserveInput(redis, "reservation_2"));

    await releaseConcurrency({ redis, reservationId: "reservation_1" });
    await releaseConcurrency({ redis, reservationId: "reservation_1" });

    expect(redis.get(concurrencyKey)).toBe(1);
    expect(redis.hash("proxy:reservation:reservation_1")).toMatchObject({
      released: "1",
    });
    expect(redis.hash("proxy:reservation:reservation_2")).toMatchObject({
      released: "0",
    });
  });

  it("refunds reserved cost minus actual cost on successful completion", async () => {
    const redis = new FakeRedis();
    const result = await reserveBudget(reserveInput(redis));
    expect(result.ok && result.reservedMicroUsd).toBe(250_000);

    await refundReservation({
      redis,
      reservationId: RESERVATION_ID,
      actualCostUsd: 0.1,
    });

    expect(redis.get(hourKey)).toBe(100_000);
    expect(redis.get(dayKey)).toBe(100_000);
    expect(redis.get(monthKey)).toBe(100_000);
    expect(redis.hash(reservationKey)).toMatchObject({ reconciled: "1" });
  });

  it("uses original reservation-time budget keys when refunding after an hour boundary", async () => {
    const redis = new FakeRedis();
    await reserveBudget(reserveInput(redis));
    redis.set(nextHourKey, 900_000);

    await refundReservation({
      redis,
      reservationId: RESERVATION_ID,
      actualCostUsd: 0.1,
      now: new Date("2026-06-07T09:00:01.000Z"),
    });

    expect(redis.get(hourKey)).toBe(100_000);
    expect(redis.get(nextHourKey)).toBe(900_000);
  });

  it("does not reconcile budgets twice for duplicate refund", async () => {
    const redis = new FakeRedis();
    await reserveBudget(reserveInput(redis));

    await refundReservation({
      redis,
      reservationId: RESERVATION_ID,
      actualCostUsd: 0.1,
    });
    await refundReservation({
      redis,
      reservationId: RESERVATION_ID,
      actualCostUsd: 0.1,
    });

    expect(redis.get(hourKey)).toBe(100_000);
    expect(redis.get(dayKey)).toBe(100_000);
    expect(redis.get(monthKey)).toBe(100_000);
  });

  it("adds overage to original budget keys when actual cost exceeds the reservation", async () => {
    const redis = new FakeRedis();
    await reserveBudget(reserveInput(redis));

    await refundReservation({
      redis,
      reservationId: RESERVATION_ID,
      actualCostUsd: 0.4,
    });

    expect(redis.get(hourKey)).toBe(400_000);
    expect(redis.get(dayKey)).toBe(400_000);
    expect(redis.get(monthKey)).toBe(400_000);
  });

  it("returns 503 fail-closed when Redis eval throws", async () => {
    const redis = new FakeRedis();
    redis.throwOnEval = true;

    const result = await reserveBudget(reserveInput(redis));

    expect(result).toMatchObject({
      ok: false,
      status: 503,
      code: "budget_reservation_unavailable",
    });
  });

  it("returns 503 fail-closed when Redis config is missing", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");

    const result = await reserveBudget({
      proxyKeyId: PROXY_KEY_ID,
      estimatedCostUsd: 0.25,
      hourlyLimitUsd: 1,
      dailyLimitUsd: 5,
      monthlyLimitUsd: 50,
      maxConcurrency: 2,
      now: NOW,
      reservationId: RESERVATION_ID,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 503,
      code: "budget_reservation_unavailable",
    });
  });

  it("formats budget keys with yyyyMMddHH, yyyyMMdd, and yyyyMM windows", async () => {
    const redis = new FakeRedis();

    await reserveBudget(reserveInput(redis));

    expect(redis.evalCalls[0].keys).toEqual([
      hourKey,
      dayKey,
      monthKey,
      concurrencyKey,
      reservationKey,
    ]);
  });
});

import { randomUUID } from "node:crypto";
import { getRedis } from "@/lib/proxy/redis";

const MICRO_USD_PER_USD = 1_000_000;
const CONCURRENCY_TTL_SECONDS = 60 * 60;
const WINDOW_GRACE_SECONDS = 60 * 60;

export interface RedisLike {
  eval(
    script: string,
    keys: string[],
    args: (string | number)[]
  ): Promise<unknown>;
}

export type ReservationResult =
  | { ok: true; reservationId: string; reservedMicroUsd: number }
  | { ok: false; status: 429 | 503; code: string; message: string };

const RESERVE_SCRIPT = `
local reserved = tonumber(ARGV[1])
local hourlyLimit = tonumber(ARGV[2])
local dailyLimit = tonumber(ARGV[3])
local monthlyLimit = tonumber(ARGV[4])
local maxConcurrency = tonumber(ARGV[5])
local hourTtl = tonumber(ARGV[6])
local dayTtl = tonumber(ARGV[7])
local monthTtl = tonumber(ARGV[8])
local concurrencyTtl = tonumber(ARGV[9])
local reservationTtl = tonumber(ARGV[10])
local proxyKeyId = ARGV[11]

if redis.call("EXISTS", KEYS[5]) == 1 then
  return {0, "reservation_already_exists"}
end

local hourUsed = tonumber(redis.call("GET", KEYS[1]) or "0")
if hourUsed + reserved > hourlyLimit then
  return {0, "hourly_budget_exceeded"}
end

local dayUsed = tonumber(redis.call("GET", KEYS[2]) or "0")
if dayUsed + reserved > dailyLimit then
  return {0, "daily_budget_exceeded"}
end

local monthUsed = tonumber(redis.call("GET", KEYS[3]) or "0")
if monthUsed + reserved > monthlyLimit then
  return {0, "monthly_budget_exceeded"}
end

local concurrency = tonumber(redis.call("GET", KEYS[4]) or "0")
if concurrency + 1 > maxConcurrency then
  return {0, "concurrency_exceeded"}
end

redis.call("INCRBY", KEYS[1], reserved)
redis.call("EXPIRE", KEYS[1], hourTtl)
redis.call("INCRBY", KEYS[2], reserved)
redis.call("EXPIRE", KEYS[2], dayTtl)
redis.call("INCRBY", KEYS[3], reserved)
redis.call("EXPIRE", KEYS[3], monthTtl)
redis.call("INCRBY", KEYS[4], 1)
redis.call("EXPIRE", KEYS[4], concurrencyTtl)
redis.call(
  "HSET",
  KEYS[5],
  "proxyKeyId", proxyKeyId,
  "hourKey", KEYS[1],
  "dayKey", KEYS[2],
  "monthKey", KEYS[3],
  "concurrencyKey", KEYS[4],
  "reservedMicroUsd", reserved,
  "released", "0",
  "reconciled", "0"
)
redis.call("EXPIRE", KEYS[5], reservationTtl)

return {1, "reserved"}
`;

const RELEASE_CONCURRENCY_SCRIPT = `
local concurrencyKey = redis.call("HGET", KEYS[1], "concurrencyKey")
if not concurrencyKey then
  return 0
end

local released = redis.call("HGET", KEYS[1], "released")
if released == "1" then
  return 0
end

local concurrency = tonumber(redis.call("GET", concurrencyKey) or "0")
if concurrency <= 1 then
  redis.call("DEL", concurrencyKey)
  redis.call("HSET", KEYS[1], "released", "1")
  return 0
end

local remaining = redis.call("DECRBY", concurrencyKey, 1)
redis.call("HSET", KEYS[1], "released", "1")
return remaining
`;

const REFUND_SCRIPT = `
local actual = tonumber(ARGV[1])
local reconciled = redis.call("HGET", KEYS[1], "reconciled")
if not reconciled or reconciled == "1" then
  return {1, "noop"}
end

local reserved = tonumber(redis.call("HGET", KEYS[1], "reservedMicroUsd") or "")
local hourKey = redis.call("HGET", KEYS[1], "hourKey")
local dayKey = redis.call("HGET", KEYS[1], "dayKey")
local monthKey = redis.call("HGET", KEYS[1], "monthKey")
if not reserved or not hourKey or not dayKey or not monthKey then
  return {1, "noop"}
end

local delta = actual - reserved
local budgetKeys = {hourKey, dayKey, monthKey}

if delta < 0 then
  local refund = -delta
  for i = 1, #budgetKeys do
    local used = tonumber(redis.call("GET", budgetKeys[i]) or "0")
    if used <= refund then
      redis.call("DEL", budgetKeys[i])
    else
      redis.call("DECRBY", budgetKeys[i], refund)
    end
  end
elseif delta > 0 then
  for i = 1, #budgetKeys do
    redis.call("INCRBY", budgetKeys[i], delta)
  end
end

redis.call("HSET", KEYS[1], "reconciled", "1")
return {1, "reconciled"}
`;

export async function reserveBudget(input: {
  redis?: RedisLike;
  proxyKeyId: string;
  estimatedCostUsd: number;
  hourlyLimitUsd: number;
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
  maxConcurrency: number;
  now?: Date;
  reservationId?: string;
}): Promise<ReservationResult> {
  const now = input.now ?? new Date();
  const reservationId = input.reservationId ?? randomUUID();
  const reservedMicroUsd = usdToMicroUsd(input.estimatedCostUsd);
  const windows = formatWindows(now);
  const ttls = calculateTtls(now);

  let evalResult: unknown;
  try {
    const redis = input.redis ?? getRedis();
    evalResult = await redis.eval(
      RESERVE_SCRIPT,
      [
        budgetHourKey(input.proxyKeyId, windows.hour),
        budgetDayKey(input.proxyKeyId, windows.day),
        budgetMonthKey(input.proxyKeyId, windows.month),
        concurrencyKey(input.proxyKeyId),
        reservationKey(reservationId),
      ],
      [
        String(reservedMicroUsd),
        String(usdToMicroUsd(input.hourlyLimitUsd)),
        String(usdToMicroUsd(input.dailyLimitUsd)),
        String(usdToMicroUsd(input.monthlyLimitUsd)),
        String(Math.floor(input.maxConcurrency)),
        String(ttls.hour),
        String(ttls.day),
        String(ttls.month),
        String(CONCURRENCY_TTL_SECONDS),
        String(ttls.month),
        input.proxyKeyId,
      ]
    );
  } catch {
    return unavailable();
  }

  const reserveCode = readReserveCode(evalResult);
  if (reserveCode === "reserved") {
    return {
      ok: true,
      reservationId,
      reservedMicroUsd,
    };
  }

  return rejectionForCode(reserveCode);
}

export async function releaseConcurrency(input: {
  redis?: RedisLike;
  reservationId: string;
  proxyKeyId?: string;
}): Promise<void> {
  const redis = input.redis ?? getRedis();
  await redis.eval(
    RELEASE_CONCURRENCY_SCRIPT,
    [reservationKey(input.reservationId)],
    []
  );
}

export async function refundReservation(input: {
  redis?: RedisLike;
  reservationId: string;
  actualCostUsd: number;
  proxyKeyId?: string;
  reservedMicroUsd?: number;
  now?: Date;
}): Promise<void> {
  const actualMicroUsd = usdToMicroUsd(input.actualCostUsd);
  const redis = input.redis ?? getRedis();
  await redis.eval(
    REFUND_SCRIPT,
    [reservationKey(input.reservationId)],
    [String(actualMicroUsd)]
  );
}

function usdToMicroUsd(usd: number): number {
  return Math.ceil(usd * MICRO_USD_PER_USD);
}

function readReserveCode(evalResult: unknown): string {
  if (!Array.isArray(evalResult)) {
    return "budget_reservation_unavailable";
  }

  const [ok, code] = evalResult;
  if (ok === 1 || ok === "1" || ok === true) {
    return "reserved";
  }

  return typeof code === "string" ? code : "budget_reservation_unavailable";
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

function calculateTtls(now: Date): {
  hour: number;
  day: number;
  month: number;
} {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();
  const hour = now.getUTCHours();

  return {
    hour:
      secondsUntil(Date.UTC(year, month, day, hour + 1), now) +
      WINDOW_GRACE_SECONDS,
    day:
      secondsUntil(Date.UTC(year, month, day + 1), now) + WINDOW_GRACE_SECONDS,
    month:
      secondsUntil(Date.UTC(year, month + 1, 1), now) + WINDOW_GRACE_SECONDS,
  };
}

function secondsUntil(timestampMs: number, now: Date): number {
  return Math.max(60, Math.ceil((timestampMs - now.getTime()) / 1000));
}

function budgetHourKey(proxyKeyId: string, window: string): string {
  return `proxy:budget:hour:${proxyKeyId}:${window}`;
}

function budgetDayKey(proxyKeyId: string, window: string): string {
  return `proxy:budget:day:${proxyKeyId}:${window}`;
}

function budgetMonthKey(proxyKeyId: string, window: string): string {
  return `proxy:budget:month:${proxyKeyId}:${window}`;
}

function concurrencyKey(proxyKeyId: string): string {
  return `proxy:concurrency:${proxyKeyId}`;
}

function reservationKey(reservationId: string): string {
  return `proxy:reservation:${reservationId}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

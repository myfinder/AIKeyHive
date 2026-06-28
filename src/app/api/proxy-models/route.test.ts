import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/__tests__/db-helper";
import { modelPrices } from "@/db/schema";

const testDbInstance = createTestDb();
vi.mock("@/db", () => ({ db: testDbInstance.db }));

import { auth } from "@/auth";

describe("proxy models API", () => {
  beforeEach(() => {
    testDbInstance.sqlite.exec("DELETE FROM model_prices");
    vi.clearAllMocks();
  });

  it("returns 401 for unauthenticated requests", async () => {
    vi.mocked(auth).mockResolvedValue(null);

    const { GET } = await import("@/app/api/proxy-models/route");
    const res = await GET();

    expect(res.status).toBe(401);
  });

  it("returns active OpenAI priced models for authenticated users", async () => {
    testDbInstance.db.insert(modelPrices).values([
      {
        id: "openai-active-b",
        provider: "openai",
        model: "gpt-5-mini",
        inputUsdPer1m: 0.25,
        cachedInputUsdPer1m: 0.025,
        outputUsdPer1m: 2,
        active: 1,
      },
      {
        id: "openai-active-a",
        provider: "openai",
        model: "gpt-4.1-mini",
        inputUsdPer1m: 0.4,
        cachedInputUsdPer1m: 0.1,
        outputUsdPer1m: 1.6,
        active: 1,
      },
      {
        id: "openai-inactive",
        provider: "openai",
        model: "gpt-5-old",
        inputUsdPer1m: 1,
        cachedInputUsdPer1m: null,
        outputUsdPer1m: 5,
        active: 0,
      },
      {
        id: "anthropic-active",
        provider: "anthropic",
        model: "claude-test",
        inputUsdPer1m: 1,
        cachedInputUsdPer1m: null,
        outputUsdPer1m: 5,
        active: 1,
      },
    ]).run();
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u1", email: "u1@test.com", role: "user" },
      expires: "",
    });

    const { GET } = await import("@/app/api/proxy-models/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([
      {
        provider: "openai",
        model: "gpt-4.1-mini",
        inputUsdPer1m: 0.4,
        cachedInputUsdPer1m: 0.1,
        outputUsdPer1m: 1.6,
      },
      {
        provider: "openai",
        model: "gpt-5-mini",
        inputUsdPer1m: 0.25,
        cachedInputUsdPer1m: 0.025,
        outputUsdPer1m: 2,
      },
    ]);
  });
});

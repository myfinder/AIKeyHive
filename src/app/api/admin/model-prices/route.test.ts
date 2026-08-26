import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/__tests__/db-helper";
import { modelPrices } from "@/db/schema";

const testDbInstance = createTestDb();
vi.mock("@/db", () => ({ db: testDbInstance.db }));

import { auth } from "@/auth";

const defaultOpenAiSeedModels = [
  "chat-latest",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4o-mini",
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-5-pro",
  "gpt-5.1",
  "gpt-5.2",
  "gpt-5.2-pro",
  "gpt-5.3-codex",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.4-pro",
  "gpt-5.5",
  "gpt-5.5-pro",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "o3",
  "o3-pro",
].sort();

function adminSession() {
  vi.mocked(auth).mockResolvedValue({
    user: { id: "admin-1", email: "admin@test.com", role: "admin" },
    expires: "",
  });
}

function jsonRequest(body: unknown, method = "POST") {
  return new Request("http://localhost/api/admin/model-prices", {
    method,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("admin model prices API", () => {
  beforeEach(() => {
    testDbInstance.sqlite.exec("DELETE FROM model_prices");
    vi.clearAllMocks();
  });

  describe("GET /api/admin/model-prices", () => {
    it("returns 403 for unauthenticated requests", async () => {
      vi.mocked(auth).mockResolvedValue(null);

      const { GET } = await import("@/app/api/admin/model-prices/route");
      const res = await GET();

      expect(res.status).toBe(403);
    });

    it("returns 403 for non-admin", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", email: "user@test.com", role: "user" },
        expires: "",
      });

      const { GET } = await import("@/app/api/admin/model-prices/route");
      const res = await GET();

      expect(res.status).toBe(403);
    });

    it("does not seed prices as a read side effect", async () => {
      adminSession();

      const { GET } = await import("@/app/api/admin/model-prices/route");
      const res = await GET();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toEqual([]);
      expect(testDbInstance.db.select().from(modelPrices).all()).toHaveLength(0);
    });

    it("returns price rows in a safe, predictable shape", async () => {
      adminSession();
      testDbInstance.db.insert(modelPrices).values([
        {
          id: "price-mini",
          provider: "openai",
          model: "gpt-5-mini",
          inputUsdPer1m: 0.25,
          cachedInputUsdPer1m: 0.025,
          outputUsdPer1m: 2,
          active: 1,
        },
        {
          id: "price-nano",
          provider: "openai",
          model: "gpt-5-nano",
          inputUsdPer1m: 0.05,
          cachedInputUsdPer1m: 0.005,
          outputUsdPer1m: 0.4,
          active: 1,
        },
      ]).run();

      const { GET } = await import("@/app/api/admin/model-prices/route");
      const res = await GET();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toEqual([
        {
          id: "price-mini",
          provider: "openai",
          model: "gpt-5-mini",
          inputUsdPer1m: 0.25,
          cachedInputUsdPer1m: 0.025,
          outputUsdPer1m: 2,
          active: true,
          createdAt: expect.any(String),
        },
        {
          id: "price-nano",
          provider: "openai",
          model: "gpt-5-nano",
          inputUsdPer1m: 0.05,
          cachedInputUsdPer1m: 0.005,
          outputUsdPer1m: 0.4,
          active: true,
          createdAt: expect.any(String),
        },
      ]);
      expect(Object.keys(body.data[0]).sort()).toEqual([
        "active",
        "cachedInputUsdPer1m",
        "createdAt",
        "id",
        "inputUsdPer1m",
        "model",
        "outputUsdPer1m",
        "provider",
      ]);
    });
  });

  describe("POST /api/admin/model-prices/seed", () => {
    it("returns 403 for non-admin", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", email: "user@test.com", role: "user" },
        expires: "",
      });

      const { POST } = await import("@/app/api/admin/model-prices/seed/route");
      const res = await POST();

      expect(res.status).toBe(403);
    });

    it("seeds default OpenAI prices explicitly and remains idempotent", async () => {
      adminSession();

      const { POST } = await import("@/app/api/admin/model-prices/seed/route");
      const first = await POST();
      const firstBody = await first.json();
      const second = await POST();
      const secondBody = await second.json();
      expect(first.status).toBe(200);
      expect(firstBody.data).toHaveLength(defaultOpenAiSeedModels.length);
      expect(firstBody.data.map((row: { model: string }) => row.model).sort())
        .toEqual(defaultOpenAiSeedModels);
      expect(second.status).toBe(200);
      expect(secondBody.data).toEqual([]);

      const stored = testDbInstance.db.select().from(modelPrices).all();
      expect(stored).toHaveLength(defaultOpenAiSeedModels.length);
      expect(stored.filter((row) => row.active === 1)).toHaveLength(
        defaultOpenAiSeedModels.length
      );
    });
  });

  describe("POST /api/admin/model-prices", () => {
    it("returns 403 for unauthenticated requests", async () => {
      vi.mocked(auth).mockResolvedValue(null);

      const { POST } = await import("@/app/api/admin/model-prices/route");
      const res = await POST(
        jsonRequest({
          provider: "openai",
          model: "gpt-5-mini",
          inputUsdPer1m: 0.25,
          outputUsdPer1m: 2,
          active: true,
        }) as never
      );

      expect(res.status).toBe(403);
    });

    it("returns 403 for non-admin", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", email: "user@test.com", role: "user" },
        expires: "",
      });

      const { POST } = await import("@/app/api/admin/model-prices/route");
      const res = await POST(
        jsonRequest({
          provider: "openai",
          model: "gpt-5-mini",
          inputUsdPer1m: 0.25,
          outputUsdPer1m: 2,
          active: true,
        }) as never
      );

      expect(res.status).toBe(403);
    });

    it.each([
      ["invalid provider", { provider: "cohere" }],
      ["blank model", { model: "   " }],
      ["non-positive input price", { inputUsdPer1m: 0 }],
      ["non-positive cached input price", { cachedInputUsdPer1m: 0 }],
      ["non-positive output price", { outputUsdPer1m: -1 }],
      ["invalid active flag", { active: 1 }],
    ])("rejects %s", async (_name, override) => {
      adminSession();

      const { POST } = await import("@/app/api/admin/model-prices/route");
      const res = await POST(
        jsonRequest({
          provider: "openai",
          model: "gpt-5-mini",
          inputUsdPer1m: 0.25,
          cachedInputUsdPer1m: 0.025,
          outputUsdPer1m: 2,
          active: true,
          ...override,
        }) as never
      );

      expect(res.status).toBe(400);
    });

    it("returns 400 for malformed JSON", async () => {
      adminSession();

      const { POST } = await import("@/app/api/admin/model-prices/route");
      const req = new Request("http://localhost/api/admin/model-prices", {
        method: "POST",
        body: "{",
        headers: { "Content-Type": "application/json" },
      });
      const res = await POST(req as never);

      expect(res.status).toBe(400);
    });

    it("inserts a valid price row and returns it with boolean active", async () => {
      adminSession();

      const { POST } = await import("@/app/api/admin/model-prices/route");
      const res = await POST(
        jsonRequest({
          provider: "anthropic",
          model: "claude-test",
          inputUsdPer1m: 3,
          cachedInputUsdPer1m: null,
          outputUsdPer1m: 15,
          active: false,
        }) as never
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toEqual({
        id: expect.any(String),
        provider: "anthropic",
        model: "claude-test",
        inputUsdPer1m: 3,
        cachedInputUsdPer1m: null,
        outputUsdPer1m: 15,
        active: false,
        createdAt: expect.any(String),
      });

      const stored = testDbInstance.db.select().from(modelPrices).all();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        provider: "anthropic",
        model: "claude-test",
        inputUsdPer1m: 3,
        cachedInputUsdPer1m: null,
        outputUsdPer1m: 15,
        active: 0,
      });
    });

    it("rejects a duplicate active provider and model with 409", async () => {
      adminSession();
      testDbInstance.db
        .insert(modelPrices)
        .values({
          provider: "openai",
          model: "gpt-5-mini",
          inputUsdPer1m: 0.25,
          cachedInputUsdPer1m: 0.025,
          outputUsdPer1m: 2,
          active: 1,
        })
        .run();

      const { POST } = await import("@/app/api/admin/model-prices/route");
      const res = await POST(
        jsonRequest({
          provider: "openai",
          model: "gpt-5-mini",
          inputUsdPer1m: 0.5,
          cachedInputUsdPer1m: 0.05,
          outputUsdPer1m: 4,
          active: true,
        }) as never
      );
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.error).toContain("active price");
      expect(testDbInstance.db.select().from(modelPrices).all()).toHaveLength(1);
    });

    it("allows an inactive historical duplicate for the same provider and model", async () => {
      adminSession();
      testDbInstance.db
        .insert(modelPrices)
        .values({
          provider: "openai",
          model: "gpt-5-mini",
          inputUsdPer1m: 0.25,
          cachedInputUsdPer1m: 0.025,
          outputUsdPer1m: 2,
          active: 1,
        })
        .run();

      const { POST } = await import("@/app/api/admin/model-prices/route");
      const res = await POST(
        jsonRequest({
          provider: "openai",
          model: "gpt-5-mini",
          inputUsdPer1m: 0.5,
          cachedInputUsdPer1m: 0.05,
          outputUsdPer1m: 4,
          active: false,
        }) as never
      );

      expect(res.status).toBe(200);
      expect(testDbInstance.db.select().from(modelPrices).all()).toHaveLength(2);
    });
  });

  describe("PATCH /api/admin/model-prices", () => {
    it("returns 403 for non-admin", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", email: "user@test.com", role: "user" },
        expires: "",
      });

      const { PATCH } = await import("@/app/api/admin/model-prices/route");
      const res = await PATCH(
        jsonRequest({ id: "price-1", active: false }, "PATCH") as never
      );

      expect(res.status).toBe(403);
    });

    it("deactivates an active price so a replacement active price can be inserted", async () => {
      adminSession();
      testDbInstance.db
        .insert(modelPrices)
        .values({
          id: "price-old",
          provider: "openai",
          model: "gpt-5-mini",
          inputUsdPer1m: 0.25,
          cachedInputUsdPer1m: 0.025,
          outputUsdPer1m: 2,
          active: 1,
        })
        .run();

      const route = await import("@/app/api/admin/model-prices/route");
      const patch = await route.PATCH(
        jsonRequest({ id: "price-old", active: false }, "PATCH") as never
      );
      const patchBody = await patch.json();

      expect(patch.status).toBe(200);
      expect(patchBody.data).toMatchObject({
        id: "price-old",
        active: false,
      });

      const post = await route.POST(
        jsonRequest({
          provider: "openai",
          model: "gpt-5-mini",
          inputUsdPer1m: 0.5,
          cachedInputUsdPer1m: 0.05,
          outputUsdPer1m: 4,
          active: true,
        }) as never
      );

      expect(post.status).toBe(200);
      const rows = testDbInstance.db.select().from(modelPrices).all();
      expect(rows).toHaveLength(2);
      expect(rows.filter((row) => row.active === 1)).toHaveLength(1);
    });

    it("rejects activating a historical price while another active price exists", async () => {
      adminSession();
      testDbInstance.db
        .insert(modelPrices)
        .values([
          {
            id: "price-active",
            provider: "openai",
            model: "gpt-5-mini",
            inputUsdPer1m: 0.25,
            cachedInputUsdPer1m: 0.025,
            outputUsdPer1m: 2,
            active: 1,
          },
          {
            id: "price-historical",
            provider: "openai",
            model: "gpt-5-mini",
            inputUsdPer1m: 0.2,
            cachedInputUsdPer1m: 0.02,
            outputUsdPer1m: 1.8,
            active: 0,
          },
        ])
        .run();

      const { PATCH } = await import("@/app/api/admin/model-prices/route");
      const res = await PATCH(
        jsonRequest({ id: "price-historical", active: true }, "PATCH") as never
      );
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.error).toContain("active price");
      const rows = testDbInstance.db.select().from(modelPrices).all();
      expect(rows.filter((row) => row.active === 1)).toHaveLength(1);
    });
  });
});

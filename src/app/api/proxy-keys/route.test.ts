import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, seedUser } from "@/__tests__/db-helper";
import { proxyKeyPolicies, proxyKeys } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashProxyKeySecret } from "@/lib/proxy/key";

const testDbInstance = createTestDb();
vi.mock("@/db", () => ({ db: testDbInstance.db }));

import { auth } from "@/auth";

const validBody = {
  name: "team-prod",
  allowedModels: ["gpt-4.1-mini"],
  hourlyLimitUsd: 1,
  dailyLimitUsd: 10,
  monthlyLimitUsd: 100,
  maxRequestUsd: 0.25,
  maxOutputTokens: 1000,
  maxConcurrency: 3,
};

function postRequest(body: unknown) {
  return new Request("http://localhost/api/proxy-keys", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("proxy keys API", () => {
  beforeEach(() => {
    testDbInstance.sqlite.exec("DROP TRIGGER IF EXISTS fail_proxy_policy_insert");
    testDbInstance.sqlite.exec("DELETE FROM proxy_key_policies");
    testDbInstance.sqlite.exec("DELETE FROM proxy_keys");
    testDbInstance.sqlite.exec("DELETE FROM users");
    vi.clearAllMocks();
  });

  describe("GET /api/proxy-keys", () => {
    it("returns 401 for unauthenticated", async () => {
      vi.mocked(auth).mockResolvedValue(null);
      const { GET } = await import("@/app/api/proxy-keys/route");

      const res = await GET();

      expect(res.status).toBe(401);
    });

    it("returns only current user's proxy keys without exposing keyHash", async () => {
      seedUser(testDbInstance.db, {
        id: "u1",
        oidcSub: "sub1",
        email: "u1@test.com",
      });
      seedUser(testDbInstance.db, {
        id: "u2",
        oidcSub: "sub2",
        email: "u2@test.com",
      });

      testDbInstance.db.insert(proxyKeys).values([
        {
          id: "pk1",
          userId: "u1",
          name: "mine",
          keyHash: "hash-mine",
          keyHint: "akp_...111111",
          status: "active",
        },
        {
          id: "pk2",
          userId: "u2",
          name: "theirs",
          keyHash: "hash-theirs",
          keyHint: "akp_...222222",
          status: "active",
        },
      ]).run();
      testDbInstance.db.insert(proxyKeyPolicies).values([
        {
          id: "pol1",
          proxyKeyId: "pk1",
          provider: "openai",
          allowedModelsJson: JSON.stringify(["gpt-4.1-mini"]),
          hourlyLimitUsd: 1,
          dailyLimitUsd: 10,
          monthlyLimitUsd: 100,
          maxRequestUsd: 0.25,
          maxOutputTokens: 1000,
          maxConcurrency: 3,
          allowTools: 0,
        },
        {
          id: "pol2",
          proxyKeyId: "pk2",
          provider: "openai",
          allowedModelsJson: JSON.stringify(["gpt-4.1"]),
          hourlyLimitUsd: 2,
          dailyLimitUsd: 20,
          monthlyLimitUsd: 200,
          maxRequestUsd: 0.5,
          maxOutputTokens: 2000,
          maxConcurrency: 4,
          allowTools: 0,
        },
      ]).run();

      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "u1@test.com", role: "admin" },
        expires: "",
      });

      const { GET } = await import("@/app/api/proxy-keys/route");
      const res = await GET();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({
        id: "pk1",
        name: "mine",
        keyHint: "akp_...111111",
        status: "active",
        policy: {
          provider: "openai",
          allowedModels: ["gpt-4.1-mini"],
          hourlyLimitUsd: 1,
          dailyLimitUsd: 10,
          monthlyLimitUsd: 100,
          maxRequestUsd: 0.25,
          maxOutputTokens: 1000,
          maxConcurrency: 3,
          allowTools: false,
        },
      });
      expect(body.data[0]).not.toHaveProperty("keyHash");
      expect(body.data[0]).not.toHaveProperty("userId");
      expect(JSON.stringify(body)).not.toContain("hash-mine");
      expect(JSON.stringify(body)).not.toContain("hash-theirs");
    });
  });

  describe("POST /api/proxy-keys", () => {
    it("returns 401 for unauthenticated", async () => {
      vi.mocked(auth).mockResolvedValue(null);
      const { POST } = await import("@/app/api/proxy-keys/route");

      const res = await POST(postRequest(validBody) as never);

      expect(res.status).toBe(401);
    });

    it("stores only keyHash and returns the raw key once", async () => {
      seedUser(testDbInstance.db, {
        id: "u1",
        oidcSub: "sub1",
        email: "u1@test.com",
      });

      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "u1@test.com", role: "user" },
        expires: "",
      });

      const { POST } = await import("@/app/api/proxy-keys/route");
      const res = await POST(postRequest(validBody) as never);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toContain("no-store");
      expect(res.headers.get("Pragma")).toBe("no-cache");
      expect(body.key).toMatch(/^akp_/);
      expect(body.data).toMatchObject({
        name: "team-prod",
        keyHint: expect.stringMatching(/^akp_\.\.\./),
        status: "active",
        policy: {
          provider: "openai",
          allowedModels: ["gpt-4.1-mini"],
          hourlyLimitUsd: 1,
          dailyLimitUsd: 10,
          monthlyLimitUsd: 100,
          maxRequestUsd: 0.25,
          maxOutputTokens: 1000,
          maxConcurrency: 3,
          allowTools: false,
        },
      });
      expect(body.data).not.toHaveProperty("keyHash");
      expect(body).not.toHaveProperty("keyHash");
      expect(JSON.stringify(body.data)).not.toContain(body.key);

      const storedKey = testDbInstance.db
        .select()
        .from(proxyKeys)
        .where(eq(proxyKeys.id, body.data.id))
        .get();
      expect(storedKey).toBeDefined();
      const storedHash = storedKey!.keyHash;
      expect(storedHash).toBe(hashProxyKeySecret(body.key));
      expect(storedHash).not.toBe(body.key);
      expect(storedKey?.keyHint).toBe(body.data.keyHint);
      expect(JSON.stringify(body)).not.toContain(storedHash);

      const storedPolicy = testDbInstance.db
        .select()
        .from(proxyKeyPolicies)
        .where(eq(proxyKeyPolicies.proxyKeyId, body.data.id))
        .get();
      expect(storedPolicy).toMatchObject({
        provider: "openai",
        allowedModelsJson: JSON.stringify(["gpt-4.1-mini"]),
        hourlyLimitUsd: 1,
        dailyLimitUsd: 10,
        monthlyLimitUsd: 100,
        maxRequestUsd: 0.25,
        maxOutputTokens: 1000,
        maxConcurrency: 3,
        allowTools: 0,
      });
    });

    it("returns 409 for duplicate active names for the same user", async () => {
      seedUser(testDbInstance.db, {
        id: "u1",
        oidcSub: "sub1",
        email: "u1@test.com",
      });
      testDbInstance.db.insert(proxyKeys).values({
        id: "pk1",
        userId: "u1",
        name: "team-prod",
        keyHash: "existing-hash",
        keyHint: "akp_...111111",
        status: "active",
      }).run();

      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "u1@test.com", role: "user" },
        expires: "",
      });

      const { POST } = await import("@/app/api/proxy-keys/route");
      const res = await POST(postRequest(validBody) as never);

      expect(res.status).toBe(409);
      expect(testDbInstance.db.select().from(proxyKeys).all()).toHaveLength(1);
    });

    it("returns 400 for malformed JSON", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "u1@test.com", role: "user" },
        expires: "",
      });

      const { POST } = await import("@/app/api/proxy-keys/route");
      const req = new Request("http://localhost/api/proxy-keys", {
        method: "POST",
        body: "{not-json",
        headers: { "Content-Type": "application/json" },
      });
      const res = await POST(req as never);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body).toEqual({ error: "Invalid input" });
    });

    it("rolls back proxy key insert when policy insert fails", async () => {
      seedUser(testDbInstance.db, {
        id: "u1",
        oidcSub: "sub1",
        email: "u1@test.com",
      });
      testDbInstance.sqlite.exec(`
        CREATE TRIGGER fail_proxy_policy_insert
        BEFORE INSERT ON proxy_key_policies
        BEGIN
          SELECT RAISE(FAIL, 'policy insert failed');
        END;
      `);

      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "u1@test.com", role: "user" },
        expires: "",
      });

      const { POST } = await import("@/app/api/proxy-keys/route");
      const res = await POST(postRequest(validBody) as never);
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body).toEqual({ error: "Failed to create proxy key" });
      expect(testDbInstance.db.select().from(proxyKeys).all()).toHaveLength(0);
    });

    it("returns 400 for invalid policy input", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "u1@test.com", role: "user" },
        expires: "",
      });

      const { POST } = await import("@/app/api/proxy-keys/route");
      const res = await POST(postRequest({
        ...validBody,
        name: "bad name",
        allowedModels: [],
        hourlyLimitUsd: 20,
        dailyLimitUsd: 10,
        maxConcurrency: 11,
      }) as never);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body).not.toHaveProperty("details");
    });
  });
});

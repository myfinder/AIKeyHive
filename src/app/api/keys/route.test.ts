import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, seedUser } from "@/__tests__/db-helper";
import { apiKeys, anthropicKeyPool } from "@/db/schema";
import { eq } from "drizzle-orm";
import { encrypt } from "@/lib/crypto";

vi.mock("@/lib/providers/openai", () => ({
  createProject: vi.fn().mockResolvedValue({ id: "proj-123", name: "test" }),
  createServiceAccountKey: vi.fn().mockResolvedValue({
    id: "sa-123",
    name: "test-sa",
    api_key: { value: "sk-test-key-value-1234", name: "key", id: "key-1" },
  }),
  deleteServiceAccount: vi.fn().mockResolvedValue(undefined),
  listProjectApiKeys: vi.fn().mockResolvedValue({ data: [] }),
}));
vi.mock("@/lib/providers/gemini", () => ({
  createKey: vi.fn().mockResolvedValue({
    key: { name: "projects/p/locations/global/keys/gk-123" },
    keyString: "AIzaSyTestKeyValue1234",
  }),
  extractKeyId: vi.fn().mockReturnValue("gk-123"),
  deleteKey: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/providers/anthropic", () => ({
  archiveKey: vi.fn().mockResolvedValue(undefined),
  fetchLastUsedByApiKey: vi.fn().mockResolvedValue(new Map()),
}));

const testDbInstance = createTestDb();
vi.mock("@/db", () => ({ db: testDbInstance.db }));

import { auth } from "@/auth";
import * as openai from "@/lib/providers/openai";
import * as anthropic from "@/lib/providers/anthropic";

const validDirectKeyPayload = {
  expiresInDays: 30,
};

describe("keys API", () => {
  beforeEach(() => {
    testDbInstance.sqlite.exec("DELETE FROM api_keys");
    testDbInstance.sqlite.exec("DELETE FROM anthropic_key_pool");
    testDbInstance.sqlite.exec("DELETE FROM users");
    vi.clearAllMocks();
  });

  describe("GET /api/keys", () => {
    it("returns 401 for unauthenticated", async () => {
      vi.mocked(auth).mockResolvedValue(null);
      const { GET } = await import("@/app/api/keys/route");
      const res = await GET();
      expect(res.status).toBe(401);
    });

    it("returns only current user's keys", async () => {
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

      testDbInstance.db.insert(apiKeys).values([
        { id: "k1", userId: "u1", provider: "openai", name: "key1", keyHint: "sk-...1234" },
        { id: "k2", userId: "u2", provider: "openai", name: "key2", keyHint: "sk-...5678" },
      ]).run();

      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "u1@test.com", role: "user" },
        expires: "",
      });

      const { GET } = await import("@/app/api/keys/route");
      const res = await GET();
      const body = await res.json();

      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe("k1");
    });

    it("does not expose userId or providerKeyId", async () => {
      seedUser(testDbInstance.db, {
        id: "u1",
        oidcSub: "sub1",
        email: "u1@test.com",
      });
      testDbInstance.db.insert(apiKeys).values({
        id: "k1",
        userId: "u1",
        provider: "openai",
        name: "key1",
        providerKeyId: "secret-provider-id",
        keyHint: "sk-...1234",
      }).run();

      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "u1@test.com", role: "user" },
        expires: "",
      });

      const { GET } = await import("@/app/api/keys/route");
      const res = await GET();
      const body = await res.json();

      expect(body.data[0]).not.toHaveProperty("userId");
      expect(body.data[0]).not.toHaveProperty("providerKeyId");
    });

    it("returns expiration and lifecycle status", async () => {
      seedUser(testDbInstance.db, {
        id: "u1",
        oidcSub: "sub1",
        email: "u1@test.com",
      });
      testDbInstance.db.insert(apiKeys).values({
        id: "k1",
        userId: "u1",
        provider: "openai",
        name: "key1",
        keyHint: "sk-...1234",
        expiresAt: "2026-07-30T00:00:00.000Z",
        status: "active",
      }).run();

      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "u1@test.com", role: "user" },
        expires: "",
      });

      const { GET } = await import("@/app/api/keys/route");
      const res = await GET();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data[0].expiresAt).toBe("2026-07-30T00:00:00.000Z");
      expect(body.data[0].status).toBe("active");
    });

    it("returns lastUsedAt from provider lookups", async () => {
      seedUser(testDbInstance.db, {
        id: "u1",
        oidcSub: "sub1",
        email: "u1@test.com",
        openaiProjectId: "proj-123",
      });
      testDbInstance.db.insert(apiKeys).values([
        { id: "k1", userId: "u1", provider: "openai", name: "oai", providerKeyId: "sa-123", keyHint: "sk-...1234" },
        { id: "k2", userId: "u1", provider: "anthropic", name: "ant", providerKeyId: "ant-key-1", keyHint: "sk-a...5678" },
        { id: "k3", userId: "u1", provider: "gemini", name: "gem", providerKeyId: "gk-123", keyHint: "AIza...9999" },
      ]).run();

      vi.mocked(openai.listProjectApiKeys).mockResolvedValue({
        data: [
          {
            id: "key-1",
            name: "oai",
            redacted_value: "sk-...1234",
            last_used_at: 1765000000,
            owner: { type: "service_account", service_account: { id: "sa-123" } },
          },
        ],
      });
      vi.mocked(anthropic.fetchLastUsedByApiKey).mockResolvedValue(
        new Map([["ant-key-1", "2026-06-05T00:00:00Z"]])
      );

      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "u1@test.com", role: "user" },
        expires: "",
      });

      const { GET } = await import("@/app/api/keys/route");
      const res = await GET();
      const body = await res.json();

      const byProvider = Object.fromEntries(
        body.data.map((k: { provider: string; lastUsedAt: string | null }) => [
          k.provider,
          k.lastUsedAt,
        ])
      );
      expect(byProvider.openai).toBe(new Date(1765000000 * 1000).toISOString());
      expect(byProvider.anthropic).toBe("2026-06-05T00:00:00Z");
      expect(byProvider.gemini).toBeNull();
    });

    it("degrades lastUsedAt to null when provider lookups fail", async () => {
      seedUser(testDbInstance.db, {
        id: "u1",
        oidcSub: "sub1",
        email: "u1@test.com",
        openaiProjectId: "proj-123",
      });
      testDbInstance.db.insert(apiKeys).values([
        { id: "k1", userId: "u1", provider: "openai", name: "oai", providerKeyId: "sa-123", keyHint: "sk-...1234" },
        { id: "k2", userId: "u1", provider: "anthropic", name: "ant", providerKeyId: "ant-key-1", keyHint: "sk-a...5678" },
      ]).run();

      vi.mocked(openai.listProjectApiKeys).mockRejectedValue(new Error("openai down"));
      vi.mocked(anthropic.fetchLastUsedByApiKey).mockRejectedValue(new Error("anthropic down"));

      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "u1@test.com", role: "user" },
        expires: "",
      });

      const { GET } = await import("@/app/api/keys/route");
      const res = await GET();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(2);
      expect(body.data.every((k: { lastUsedAt: string | null }) => k.lastUsedAt === null)).toBe(true);
    });
  });

  describe("POST /api/keys", () => {
    it("returns 401 for unauthenticated", async () => {
      vi.mocked(auth).mockResolvedValue(null);
      const { POST } = await import("@/app/api/keys/route");
      const req = new Request("http://localhost/api/keys", {
        method: "POST",
        body: JSON.stringify({ provider: "openai", name: "test", ...validDirectKeyPayload }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await POST(req as never);
      expect(res.status).toBe(401);
    });

    it("returns 400 for invalid input", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "u1@test.com", role: "user" },
        expires: "",
      });

      const { POST } = await import("@/app/api/keys/route");
      const req = new Request("http://localhost/api/keys", {
        method: "POST",
        body: JSON.stringify({ provider: "invalid", name: "", ...validDirectKeyPayload }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await POST(req as never);
      const body = await res.json();

      expect(res.status).toBe(400);
      // Should NOT leak validation details
      expect(body).not.toHaveProperty("details");
    });

    it("requires either a bounded expiration period or explicit no-expiration mode", async () => {
      seedUser(testDbInstance.db, {
        id: "u1",
        oidcSub: "sub1",
        email: "u1@test.com",
        openaiProjectId: "proj-123",
      });

      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "u1@test.com", role: "user" },
        expires: "",
      });

      const { POST } = await import("@/app/api/keys/route");
      const req = new Request("http://localhost/api/keys", {
        method: "POST",
        body: JSON.stringify({
          provider: "openai",
          name: "missing-expiration",
        }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await POST(req as never);

      expect(res.status).toBe(400);
      expect(openai.createServiceAccountKey).not.toHaveBeenCalled();
    });

    it("allows no-expiration keys only when explicitly requested", async () => {
      seedUser(testDbInstance.db, {
        id: "u1",
        oidcSub: "sub1",
        email: "u1@test.com",
        openaiProjectId: "proj-123",
      });

      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "u1@test.com", role: "user" },
        expires: "",
      });

      const { POST } = await import("@/app/api/keys/route");
      const req = new Request("http://localhost/api/keys", {
        method: "POST",
        body: JSON.stringify({
          provider: "openai",
          name: "no-expiration-key",
          noExpiration: true,
        }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await POST(req as never);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.status).toBe("active");
      expect(body.data.expiresAt).toBeNull();
      expect(openai.createServiceAccountKey).toHaveBeenCalled();
    });

    it("requires an expiration period between 1 and 366 days", async () => {
      seedUser(testDbInstance.db, {
        id: "u1",
        oidcSub: "sub1",
        email: "u1@test.com",
        openaiProjectId: "proj-123",
      });

      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "u1@test.com", role: "user" },
        expires: "",
      });

      const { POST } = await import("@/app/api/keys/route");

      for (const expiresInDays of [0, 367]) {
        const req = new Request("http://localhost/api/keys", {
          method: "POST",
          body: JSON.stringify({
            provider: "openai",
            name: `key-${expiresInDays}`,
            expiresInDays,
          }),
          headers: { "Content-Type": "application/json" },
        });
        const res = await POST(req as never);
        expect(res.status).toBe(400);
      }

      expect(openai.createServiceAccountKey).not.toHaveBeenCalled();
    });

    it("prevents duplicate key names for same provider", async () => {
      seedUser(testDbInstance.db, {
        id: "u1",
        oidcSub: "sub1",
        email: "u1@test.com",
      });
      testDbInstance.db.insert(apiKeys).values({
        id: "k1",
        userId: "u1",
        provider: "openai",
        name: "my-key",
      }).run();

      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "u1@test.com", role: "user" },
        expires: "",
      });

      const { POST } = await import("@/app/api/keys/route");
      const req = new Request("http://localhost/api/keys", {
        method: "POST",
        body: JSON.stringify({ provider: "openai", name: "my-key", ...validDirectKeyPayload }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await POST(req as never);
      expect(res.status).toBe(409);
    });

    it("stores expiration metadata for newly created keys", async () => {
      const before = Date.now();
      seedUser(testDbInstance.db, {
        id: "u1",
        oidcSub: "sub1",
        email: "u1@test.com",
        openaiProjectId: "proj-123",
      });

      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "u1@test.com", role: "user" },
        expires: "",
      });

      const { POST } = await import("@/app/api/keys/route");
      const req = new Request("http://localhost/api/keys", {
        method: "POST",
        body: JSON.stringify({
          provider: "openai",
          name: "new-key",
          ...validDirectKeyPayload,
        }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await POST(req as never);
      const body = await res.json();
      const after = Date.now();

      expect(res.status).toBe(200);
      expect(body.data.status).toBe("active");
      expect(body.data.expiresAt).toBeTruthy();
      const expiresAt = Date.parse(body.data.expiresAt);
      expect(expiresAt).toBeGreaterThanOrEqual(before + 29 * 24 * 60 * 60 * 1000);
      expect(expiresAt).toBeLessThanOrEqual(after + 31 * 24 * 60 * 60 * 1000);

      const saved = testDbInstance.db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.name, "new-key"))
        .get();
      expect(saved?.status).toBe("active");
      expect(saved?.expiresAt).toBe(body.data.expiresAt);
    });

    it("assigns Anthropic key from pool atomically", async () => {
      seedUser(testDbInstance.db, {
        id: "u1",
        oidcSub: "sub1",
        email: "u1@test.com",
      });

      testDbInstance.db.insert(anthropicKeyPool).values({
        id: "p1",
        anthropicKeyId: "ant-key-1",
        keyHint: "sk-a...XyZw",
        keyValue: encrypt("sk-ant-api03-full-key-value"),
        status: "available",
      }).run();

      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "u1@test.com", role: "user" },
        expires: "",
      });

      const { POST } = await import("@/app/api/keys/route");
      const req = new Request("http://localhost/api/keys", {
        method: "POST",
        body: JSON.stringify({ provider: "anthropic", name: "my-ant-key", ...validDirectKeyPayload }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await POST(req as never);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.key).toBe("sk-ant-api03-full-key-value");
      // Verify pool key is now assigned
      const poolKey = testDbInstance.db
        .select()
        .from(anthropicKeyPool)
        .where(eq(anthropicKeyPool.id, "p1"))
        .get();
      expect(poolKey?.status).toBe("assigned");
      expect(poolKey?.assignedTo).toBe("u1");
    });

    it("returns 409 when Anthropic pool is exhausted", async () => {
      seedUser(testDbInstance.db, {
        id: "u1",
        oidcSub: "sub1",
        email: "u1@test.com",
      });

      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "u1@test.com", role: "user" },
        expires: "",
      });

      const { POST } = await import("@/app/api/keys/route");
      const req = new Request("http://localhost/api/keys", {
        method: "POST",
        body: JSON.stringify({ provider: "anthropic", name: "my-ant-key", ...validDirectKeyPayload }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await POST(req as never);
      expect(res.status).toBe(409);
    });

    it("does not expose providerKeyId or userId in POST response", async () => {
      seedUser(testDbInstance.db, {
        id: "u1",
        oidcSub: "sub1",
        email: "u1@test.com",
        openaiProjectId: "proj-123",
      });

      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "u1@test.com", role: "user" },
        expires: "",
      });

      const { POST } = await import("@/app/api/keys/route");
      const req = new Request("http://localhost/api/keys", {
        method: "POST",
        body: JSON.stringify({ provider: "openai", name: "new-key", ...validDirectKeyPayload }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await POST(req as never);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).not.toHaveProperty("providerKeyId");
      expect(body.data).not.toHaveProperty("userId");
      expect(body.data).toHaveProperty("expiresAt");
      expect(body.data).toHaveProperty("status", "active");
      expect(body.key).toBeDefined();
    });
  });
});

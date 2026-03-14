import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, seedUser } from "@/__tests__/db-helper";
import { anthropicKeyPool } from "@/db/schema";

vi.mock("@/lib/providers/anthropic", () => ({
  findKeyByHint: vi.fn().mockResolvedValue({
    id: "ant-real-id",
    name: "test-key",
    partial_key_hint: "sk-a...XyZw",
    workspace_id: "wrkspc_test",
    status: "active",
  }),
}));

const testDbInstance = createTestDb();
vi.mock("@/db", () => ({ db: testDbInstance.db }));

import { auth } from "@/auth";

describe("admin pool API", () => {
  beforeEach(() => {
    testDbInstance.sqlite.exec("DELETE FROM anthropic_key_pool");
    testDbInstance.sqlite.exec("DELETE FROM users");
    vi.clearAllMocks();
  });

  describe("GET /api/admin/pool", () => {
    it("returns 403 for non-admin", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "user@test.com", role: "user" },
        expires: "",
      });

      const { GET } = await import("@/app/api/admin/pool/route");
      const res = await GET();
      expect(res.status).toBe(403);
    });

    it("does not expose keyValue or anthropicKeyId", async () => {
      seedUser(testDbInstance.db, {
        id: "u1",
        oidcSub: "sub1",
        email: "admin@test.com",
        role: "admin",
      });

      testDbInstance.db.insert(anthropicKeyPool).values({
        id: "p1",
        anthropicKeyId: "secret-ant-id",
        keyHint: "sk-a...XyZw",
        keyValue: "sk-ant-api03-full-secret-key",
        status: "available",
      }).run();

      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "admin@test.com", role: "admin" },
        expires: "",
      });

      const { GET } = await import("@/app/api/admin/pool/route");
      const res = await GET();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).not.toHaveProperty("keyValue");
      expect(body.data[0]).not.toHaveProperty("anthropicKeyId");
      expect(body.data[0].keyHint).toBe("sk-a...XyZw");
    });
  });

  describe("POST /api/admin/pool", () => {
    it("returns 403 for non-admin", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "user@test.com", role: "user" },
        expires: "",
      });

      const { POST } = await import("@/app/api/admin/pool/route");
      const req = new Request("http://localhost/api/admin/pool", {
        method: "POST",
        body: JSON.stringify({ keyValue: "sk-ant-api03-test" }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await POST(req as never);
      expect(res.status).toBe(403);
    });

    it("rejects keys not starting with sk-ant-", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "admin@test.com", role: "admin" },
        expires: "",
      });

      const { POST } = await import("@/app/api/admin/pool/route");
      const req = new Request("http://localhost/api/admin/pool", {
        method: "POST",
        body: JSON.stringify({ keyValue: "invalid-key-format" }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await POST(req as never);
      expect(res.status).toBe(400);
    });

    it("prevents duplicate key registration", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "admin@test.com", role: "admin" },
        expires: "",
      });

      testDbInstance.db.insert(anthropicKeyPool).values({
        id: "p1",
        anthropicKeyId: "ant-1",
        keyValue: "sk-ant-api03-existing-key",
        status: "available",
      }).run();

      const { POST } = await import("@/app/api/admin/pool/route");
      const req = new Request("http://localhost/api/admin/pool", {
        method: "POST",
        body: JSON.stringify({ keyValue: "sk-ant-api03-existing-key" }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await POST(req as never);
      expect(res.status).toBe(409);
    });
  });
});

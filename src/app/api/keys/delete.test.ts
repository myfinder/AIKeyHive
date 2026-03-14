import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, seedUser } from "@/__tests__/db-helper";
import { apiKeys, anthropicKeyPool } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@/lib/providers/openai", () => ({
  deleteServiceAccount: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/providers/anthropic", () => ({
  archiveKey: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/providers/gemini", () => ({
  deleteKey: vi.fn().mockResolvedValue(undefined),
}));

const testDbInstance = createTestDb();
vi.mock("@/db", () => ({ db: testDbInstance.db }));

import { auth } from "@/auth";

describe("DELETE /api/keys/[id]", () => {
  beforeEach(() => {
    testDbInstance.sqlite.exec("DELETE FROM api_keys");
    testDbInstance.sqlite.exec("DELETE FROM anthropic_key_pool");
    testDbInstance.sqlite.exec("DELETE FROM users");
    vi.clearAllMocks();
  });

  it("returns 401 for unauthenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    const { DELETE } = await import("@/app/api/keys/[id]/route");
    const req = new Request("http://localhost/api/keys/k1", { method: "DELETE" });
    const res = await DELETE(req as never, { params: Promise.resolve({ id: "k1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 for non-existent key", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u1", email: "u1@test.com", role: "user" },
      expires: "",
    });
    const { DELETE } = await import("@/app/api/keys/[id]/route");
    const req = new Request("http://localhost/api/keys/nonexistent", {
      method: "DELETE",
    });
    const res = await DELETE(req as never, {
      params: Promise.resolve({ id: "nonexistent" }),
    });
    expect(res.status).toBe(404);
  });

  it("prevents non-admin from deleting another user's key", async () => {
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
    testDbInstance.db.insert(apiKeys).values({
      id: "k1",
      userId: "u2",
      provider: "openai",
      name: "other-key",
    }).run();

    vi.mocked(auth).mockResolvedValue({
      user: { id: "u1", email: "u1@test.com", role: "user" },
      expires: "",
    });

    const { DELETE } = await import("@/app/api/keys/[id]/route");
    const req = new Request("http://localhost/api/keys/k1", { method: "DELETE" });
    const res = await DELETE(req as never, { params: Promise.resolve({ id: "k1" }) });
    expect(res.status).toBe(404);
  });

  it("allows admin to delete another user's key", async () => {
    seedUser(testDbInstance.db, {
      id: "u1",
      oidcSub: "sub1",
      email: "admin@test.com",
      role: "admin",
    });
    seedUser(testDbInstance.db, {
      id: "u2",
      oidcSub: "sub2",
      email: "u2@test.com",
    });
    testDbInstance.db.insert(apiKeys).values({
      id: "k1",
      userId: "u2",
      provider: "gemini",
      name: "other-key",
    }).run();

    vi.mocked(auth).mockResolvedValue({
      user: { id: "u1", email: "admin@test.com", role: "admin" },
      expires: "",
    });

    const { DELETE } = await import("@/app/api/keys/[id]/route");
    const req = new Request("http://localhost/api/keys/k1", { method: "DELETE" });
    const res = await DELETE(req as never, { params: Promise.resolve({ id: "k1" }) });
    expect(res.status).toBe(200);

    const remaining = testDbInstance.db.select().from(apiKeys).all();
    expect(remaining).toHaveLength(0);
  });

  it("revokes Anthropic key on deletion and updates pool", async () => {
    const { archiveKey } = await import("@/lib/providers/anthropic");

    seedUser(testDbInstance.db, {
      id: "u1",
      oidcSub: "sub1",
      email: "u1@test.com",
    });
    testDbInstance.db.insert(anthropicKeyPool).values({
      id: "p1",
      anthropicKeyId: "ant-key-1",
      status: "assigned",
      assignedTo: "u1",
    }).run();
    testDbInstance.db.insert(apiKeys).values({
      id: "k1",
      userId: "u1",
      provider: "anthropic",
      name: "my-key",
      providerKeyId: "ant-key-1",
    }).run();

    vi.mocked(auth).mockResolvedValue({
      user: { id: "u1", email: "u1@test.com", role: "user" },
      expires: "",
    });

    const { DELETE } = await import("@/app/api/keys/[id]/route");
    const req = new Request("http://localhost/api/keys/k1", { method: "DELETE" });
    const res = await DELETE(req as never, { params: Promise.resolve({ id: "k1" }) });

    expect(res.status).toBe(200);
    expect(archiveKey).toHaveBeenCalledWith("ant-key-1");

    const poolKey = testDbInstance.db
      .select()
      .from(anthropicKeyPool)
      .where(eq(anthropicKeyPool.id, "p1"))
      .get();
    expect(poolKey?.status).toBe("disabled");
    expect(poolKey?.assignedTo).toBeNull();
  });

  it("does not leak error details on provider failure", async () => {
    const { deleteServiceAccount } = await import("@/lib/providers/openai");
    vi.mocked(deleteServiceAccount).mockRejectedValue(
      new Error("OpenAI internal: secret error detail")
    );

    seedUser(testDbInstance.db, {
      id: "u1",
      oidcSub: "sub1",
      email: "u1@test.com",
      openaiProjectId: "proj-123",
    });
    testDbInstance.db.insert(apiKeys).values({
      id: "k1",
      userId: "u1",
      provider: "openai",
      name: "key",
      providerKeyId: "sa-123",
    }).run();

    vi.mocked(auth).mockResolvedValue({
      user: { id: "u1", email: "u1@test.com", role: "user" },
      expires: "",
    });

    const { DELETE } = await import("@/app/api/keys/[id]/route");
    const req = new Request("http://localhost/api/keys/k1", { method: "DELETE" });
    const res = await DELETE(req as never, { params: Promise.resolve({ id: "k1" }) });
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toBe("Failed to delete key from provider");
    expect(JSON.stringify(body)).not.toContain("secret error detail");
  });
});

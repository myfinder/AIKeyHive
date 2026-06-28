import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, seedUser } from "@/__tests__/db-helper";
import { proxyKeys } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@/lib/providers/openai", () => ({
  deleteServiceAccount: vi.fn().mockResolvedValue(undefined),
}));

const testDbInstance = createTestDb();
vi.mock("@/db", () => ({ db: testDbInstance.db }));

import { auth } from "@/auth";

describe("DELETE /api/proxy-keys/[id]", () => {
  beforeEach(() => {
    testDbInstance.sqlite.exec("DELETE FROM proxy_key_policies");
    testDbInstance.sqlite.exec("DELETE FROM proxy_keys");
    testDbInstance.sqlite.exec("DELETE FROM users");
    vi.clearAllMocks();
  });

  it("returns 401 for unauthenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    const { DELETE } = await import("@/app/api/proxy-keys/[id]/route");
    const req = new Request("http://localhost/api/proxy-keys/pk1", {
      method: "DELETE",
    });

    const res = await DELETE(req as never, {
      params: Promise.resolve({ id: "pk1" }),
    });

    expect(res.status).toBe(401);
  });

  it("revokes the owner's own key without hard deleting it", async () => {
    const { deleteServiceAccount } = await import("@/lib/providers/openai");

    seedUser(testDbInstance.db, {
      id: "u1",
      oidcSub: "sub1",
      email: "u1@test.com",
    });
    testDbInstance.db.insert(proxyKeys).values({
      id: "pk1",
      userId: "u1",
      name: "mine",
      keyHash: "hash-mine",
      keyHint: "akp_...111111",
      status: "active",
      upstreamProjectId: "proj-proxy",
      upstreamProviderKeyId: "svc-proxy",
    }).run();

    vi.mocked(auth).mockResolvedValue({
      user: { id: "u1", email: "u1@test.com", role: "user" },
      expires: "",
    });

    const { DELETE } = await import("@/app/api/proxy-keys/[id]/route");
    const req = new Request("http://localhost/api/proxy-keys/pk1", {
      method: "DELETE",
    });
    const res = await DELETE(req as never, {
      params: Promise.resolve({ id: "pk1" }),
    });

    expect(res.status).toBe(200);
    expect(deleteServiceAccount).toHaveBeenCalledWith("proj-proxy", "svc-proxy");
    const row = testDbInstance.db
      .select()
      .from(proxyKeys)
      .where(eq(proxyKeys.id, "pk1"))
      .get();
    expect(row?.status).toBe("revoked");
    expect(row?.revokedAt).toEqual(expect.any(String));
  });

  it("still revokes locally when upstream service account deletion fails", async () => {
    const { deleteServiceAccount } = await import("@/lib/providers/openai");
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.mocked(deleteServiceAccount).mockRejectedValueOnce(
      new Error("OpenAI provider failure")
    );

    seedUser(testDbInstance.db, {
      id: "u1",
      oidcSub: "sub1",
      email: "u1@test.com",
    });
    testDbInstance.db.insert(proxyKeys).values({
      id: "pk1",
      userId: "u1",
      name: "mine",
      keyHash: "hash-mine",
      keyHint: "akp_...111111",
      status: "active",
      upstreamProjectId: "proj-proxy",
      upstreamProviderKeyId: "svc-proxy",
    }).run();

    vi.mocked(auth).mockResolvedValue({
      user: { id: "u1", email: "u1@test.com", role: "user" },
      expires: "",
    });

    const { DELETE } = await import("@/app/api/proxy-keys/[id]/route");
    const req = new Request("http://localhost/api/proxy-keys/pk1", {
      method: "DELETE",
    });
    const res = await DELETE(req as never, {
      params: Promise.resolve({ id: "pk1" }),
    });

    expect(res.status).toBe(200);
    expect(deleteServiceAccount).toHaveBeenCalledWith("proj-proxy", "svc-proxy");
    const row = testDbInstance.db
      .select()
      .from(proxyKeys)
      .where(eq(proxyKeys.id, "pk1"))
      .get();
    expect(row?.status).toBe("revoked");
    expect(row?.revokedAt).toEqual(expect.any(String));
    consoleErrorSpy.mockRestore();
  });

  it("does not overwrite revokedAt for an already revoked owner key", async () => {
    const revokedAt = "2026-06-01T12:34:56.000Z";
    seedUser(testDbInstance.db, {
      id: "u1",
      oidcSub: "sub1",
      email: "u1@test.com",
    });
    testDbInstance.db.insert(proxyKeys).values({
      id: "pk1",
      userId: "u1",
      name: "mine",
      keyHash: "hash-mine",
      keyHint: "akp_...111111",
      status: "revoked",
      revokedAt,
    }).run();

    vi.mocked(auth).mockResolvedValue({
      user: { id: "u1", email: "u1@test.com", role: "user" },
      expires: "",
    });

    const { DELETE } = await import("@/app/api/proxy-keys/[id]/route");
    const req = new Request("http://localhost/api/proxy-keys/pk1", {
      method: "DELETE",
    });
    const res = await DELETE(req as never, {
      params: Promise.resolve({ id: "pk1" }),
    });

    expect(res.status).toBe(200);
    const row = testDbInstance.db
      .select()
      .from(proxyKeys)
      .where(eq(proxyKeys.id, "pk1"))
      .get();
    expect(row?.status).toBe("revoked");
    expect(row?.revokedAt).toBe(revokedAt);
  });

  it("returns 404 for a non-admin revoking another user's key", async () => {
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
    testDbInstance.db.insert(proxyKeys).values({
      id: "pk1",
      userId: "u2",
      name: "theirs",
      keyHash: "hash-theirs",
      keyHint: "akp_...222222",
      status: "active",
    }).run();

    vi.mocked(auth).mockResolvedValue({
      user: { id: "u1", email: "u1@test.com", role: "user" },
      expires: "",
    });

    const { DELETE } = await import("@/app/api/proxy-keys/[id]/route");
    const req = new Request("http://localhost/api/proxy-keys/pk1", {
      method: "DELETE",
    });
    const res = await DELETE(req as never, {
      params: Promise.resolve({ id: "pk1" }),
    });

    expect(res.status).toBe(404);
    const row = testDbInstance.db
      .select()
      .from(proxyKeys)
      .where(eq(proxyKeys.id, "pk1"))
      .get();
    expect(row?.status).toBe("active");
    expect(row?.revokedAt).toBeNull();
  });

  it("allows an admin to revoke another user's key", async () => {
    seedUser(testDbInstance.db, {
      id: "admin",
      oidcSub: "admin-sub",
      email: "admin@test.com",
      role: "admin",
    });
    seedUser(testDbInstance.db, {
      id: "u2",
      oidcSub: "sub2",
      email: "u2@test.com",
    });
    testDbInstance.db.insert(proxyKeys).values({
      id: "pk1",
      userId: "u2",
      name: "theirs",
      keyHash: "hash-theirs",
      keyHint: "akp_...222222",
      status: "active",
    }).run();

    vi.mocked(auth).mockResolvedValue({
      user: { id: "admin", email: "admin@test.com", role: "admin" },
      expires: "",
    });

    const { DELETE } = await import("@/app/api/proxy-keys/[id]/route");
    const req = new Request("http://localhost/api/proxy-keys/pk1", {
      method: "DELETE",
    });
    const res = await DELETE(req as never, {
      params: Promise.resolve({ id: "pk1" }),
    });

    expect(res.status).toBe(200);
    const row = testDbInstance.db
      .select()
      .from(proxyKeys)
      .where(eq(proxyKeys.id, "pk1"))
      .get();
    expect(row?.status).toBe("revoked");
    expect(row?.revokedAt).toEqual(expect.any(String));
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
vi.mock("@/lib/crypto", () => ({
  verifyCronSecret: vi.fn(),
}));

const testDbInstance = createTestDb();
vi.mock("@/db", () => ({ db: testDbInstance.db }));

import { verifyCronSecret } from "@/lib/crypto";
import * as openai from "@/lib/providers/openai";
import * as anthropic from "@/lib/providers/anthropic";
import * as gemini from "@/lib/providers/gemini";

describe("GET /api/cron/expire-direct-keys", () => {
  const originalGoogleProjectId = process.env.GOOGLE_PROJECT_ID;

  beforeEach(() => {
    testDbInstance.sqlite.exec("DELETE FROM api_keys");
    testDbInstance.sqlite.exec("DELETE FROM anthropic_key_pool");
    testDbInstance.sqlite.exec("DELETE FROM users");
    vi.clearAllMocks();
    vi.mocked(verifyCronSecret).mockReturnValue(true);
    process.env.GOOGLE_PROJECT_ID = "google-project-1";
  });

  afterEach(() => {
    process.env.GOOGLE_PROJECT_ID = originalGoogleProjectId;
  });

  it("returns 401 when cron secret verification fails", async () => {
    vi.mocked(verifyCronSecret).mockReturnValue(false);

    const { GET } = await import("@/app/api/cron/expire-direct-keys/route");
    const res = await GET(new Request("http://localhost/api/cron/expire-direct-keys"));

    expect(res.status).toBe(401);
  });

  it("revokes expired OpenAI direct keys and marks them expired", async () => {
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
      name: "expired-openai",
      providerKeyId: "sa-123",
      expiresAt: "2026-01-01T00:00:00.000Z",
      status: "active",
    }).run();

    const { GET } = await import("@/app/api/cron/expire-direct-keys/route");
    const res = await GET(new Request("http://localhost/api/cron/expire-direct-keys"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.results.expired).toBe(1);
    expect(openai.deleteServiceAccount).toHaveBeenCalledWith("proj-123", "sa-123");

    const saved = testDbInstance.db.select().from(apiKeys).where(eq(apiKeys.id, "k1")).get();
    expect(saved?.status).toBe("expired");
    expect(saved?.revokedAt).toBeTruthy();
    expect(saved?.revocationError).toBeNull();
  });

  it("leaves unexpired direct keys active", async () => {
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
      name: "future-openai",
      providerKeyId: "sa-123",
      expiresAt: "2099-01-01T00:00:00.000Z",
      status: "active",
    }).run();

    const { GET } = await import("@/app/api/cron/expire-direct-keys/route");
    const res = await GET(new Request("http://localhost/api/cron/expire-direct-keys"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.results.expired).toBe(0);
    expect(openai.deleteServiceAccount).not.toHaveBeenCalled();

    const saved = testDbInstance.db.select().from(apiKeys).where(eq(apiKeys.id, "k1")).get();
    expect(saved?.status).toBe("active");
  });

  it("leaves no-expiration direct keys active", async () => {
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
      name: "no-expiration-openai",
      providerKeyId: "sa-123",
      expiresAt: null,
      status: "active",
    }).run();

    const { GET } = await import("@/app/api/cron/expire-direct-keys/route");
    const res = await GET(new Request("http://localhost/api/cron/expire-direct-keys"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.results.expired).toBe(0);
    expect(openai.deleteServiceAccount).not.toHaveBeenCalled();

    const saved = testDbInstance.db.select().from(apiKeys).where(eq(apiKeys.id, "k1")).get();
    expect(saved?.status).toBe("active");
  });

  it("leaves legacy direct keys without expiration metadata active", async () => {
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
      name: "legacy-openai",
      providerKeyId: "sa-123",
      status: "active",
    }).run();

    const { GET } = await import("@/app/api/cron/expire-direct-keys/route");
    const res = await GET(new Request("http://localhost/api/cron/expire-direct-keys"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.results.expired).toBe(0);
    expect(openai.deleteServiceAccount).not.toHaveBeenCalled();

    const saved = testDbInstance.db.select().from(apiKeys).where(eq(apiKeys.id, "k1")).get();
    expect(saved?.expiresAt).toBeNull();
    expect(saved?.status).toBe("active");
  });

  it("records revocation failures without storing raw provider errors", async () => {
    vi.mocked(openai.deleteServiceAccount).mockRejectedValueOnce(
      new Error("provider leaked sk-secret-value")
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
      name: "failed-openai",
      providerKeyId: "sa-123",
      expiresAt: "2026-01-01T00:00:00.000Z",
      status: "active",
    }).run();

    const { GET } = await import("@/app/api/cron/expire-direct-keys/route");
    const res = await GET(new Request("http://localhost/api/cron/expire-direct-keys"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.results.failed).toBe(1);

    const saved = testDbInstance.db.select().from(apiKeys).where(eq(apiKeys.id, "k1")).get();
    expect(saved?.status).toBe("revocation_failed");
    expect(saved?.revocationError).toBe("openai revocation failed");
    expect(saved?.revocationError).not.toContain("sk-secret-value");
  });

  it("retries previously failed revocations", async () => {
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
      name: "retry-openai",
      providerKeyId: "sa-123",
      expiresAt: "2026-01-01T00:00:00.000Z",
      status: "revocation_failed",
      revocationError: "openai revocation failed",
    }).run();

    const { GET } = await import("@/app/api/cron/expire-direct-keys/route");
    const res = await GET(new Request("http://localhost/api/cron/expire-direct-keys"));

    expect(res.status).toBe(200);
    expect(openai.deleteServiceAccount).toHaveBeenCalledWith("proj-123", "sa-123");

    const saved = testDbInstance.db.select().from(apiKeys).where(eq(apiKeys.id, "k1")).get();
    expect(saved?.status).toBe("expired");
    expect(saved?.revocationError).toBeNull();
  });

  it("archives expired Anthropic keys and disables their pool rows", async () => {
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
      name: "expired-anthropic",
      providerKeyId: "ant-key-1",
      expiresAt: "2026-01-01T00:00:00.000Z",
      status: "active",
    }).run();

    const { GET } = await import("@/app/api/cron/expire-direct-keys/route");
    const res = await GET(new Request("http://localhost/api/cron/expire-direct-keys"));

    expect(res.status).toBe(200);
    expect(anthropic.archiveKey).toHaveBeenCalledWith("ant-key-1");

    const saved = testDbInstance.db.select().from(apiKeys).where(eq(apiKeys.id, "k1")).get();
    const pool = testDbInstance.db
      .select()
      .from(anthropicKeyPool)
      .where(eq(anthropicKeyPool.id, "p1"))
      .get();
    expect(saved?.status).toBe("expired");
    expect(pool?.status).toBe("disabled");
    expect(pool?.assignedTo).toBeNull();
  });

  it("deletes expired Gemini keys provider-side", async () => {
    seedUser(testDbInstance.db, {
      id: "u1",
      oidcSub: "sub1",
      email: "u1@test.com",
    });
    testDbInstance.db.insert(apiKeys).values({
      id: "k1",
      userId: "u1",
      provider: "gemini",
      name: "expired-gemini",
      providerKeyId: "gk-123",
      expiresAt: "2026-01-01T00:00:00.000Z",
      status: "active",
    }).run();

    const { GET } = await import("@/app/api/cron/expire-direct-keys/route");
    const res = await GET(new Request("http://localhost/api/cron/expire-direct-keys"));

    expect(res.status).toBe(200);
    expect(gemini.deleteKey).toHaveBeenCalledWith(
      "projects/google-project-1/locations/global/keys/gk-123"
    );

    const saved = testDbInstance.db.select().from(apiKeys).where(eq(apiKeys.id, "k1")).get();
    expect(saved?.status).toBe("expired");
  });
});

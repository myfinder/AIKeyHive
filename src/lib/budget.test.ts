import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, seedUser } from "@/__tests__/db-helper";
import { budgets, costSnapshots, apiKeys, anthropicKeyPool } from "@/db/schema";

// Mock external providers
vi.mock("@/lib/providers/openai", () => ({
  deleteServiceAccount: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/providers/anthropic", () => ({
  archiveKey: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/providers/gemini", () => ({
  deleteKey: vi.fn().mockResolvedValue(undefined),
}));

// We need to mock @/db to use our test database
const testDbInstance = createTestDb();
vi.mock("@/db", () => ({
  db: testDbInstance.db,
}));

// Import after mocks
const { checkBudgets, enforcebudgets, deleteKeysForUser } = await import(
  "@/lib/budget"
);

describe("budget", () => {
  beforeEach(() => {
    // Clear all tables
    testDbInstance.sqlite.exec("DELETE FROM cost_snapshots");
    testDbInstance.sqlite.exec("DELETE FROM api_keys");
    testDbInstance.sqlite.exec("DELETE FROM anthropic_key_pool");
    testDbInstance.sqlite.exec("DELETE FROM budgets");
    testDbInstance.sqlite.exec("DELETE FROM users");
    vi.clearAllMocks();
  });

  describe("checkBudgets", () => {
    it("returns empty array when no budgets exist", async () => {
      const result = await checkBudgets();
      expect(result).toEqual([]);
    });

    it("calculates global budget usage correctly", async () => {
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

      testDbInstance.db.insert(budgets).values({
        id: "b1",
        scope: "global",
        monthlyLimitUsd: 100,
        alertThresholdPct: 80,
      }).run();

      testDbInstance.db.insert(costSnapshots).values({
        id: "c1",
        provider: "openai",
        date: monthStart,
        costUsd: 50,
      }).run();

      const result = await checkBudgets();
      expect(result).toHaveLength(1);
      expect(result[0].currentSpendUsd).toBe(50);
      expect(result[0].usagePct).toBe(50);
      expect(result[0].exceeded).toBe(false);
      expect(result[0].alertTriggered).toBe(false);
    });

    it("detects exceeded budget", async () => {
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

      testDbInstance.db.insert(budgets).values({
        id: "b1",
        scope: "global",
        monthlyLimitUsd: 100,
        alertThresholdPct: 80,
      }).run();

      testDbInstance.db.insert(costSnapshots).values({
        id: "c1",
        provider: "openai",
        date: monthStart,
        costUsd: 120,
      }).run();

      const result = await checkBudgets();
      expect(result[0].exceeded).toBe(true);
      expect(result[0].alertTriggered).toBe(true);
    });

    it("detects alert threshold without exceeding budget", async () => {
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

      testDbInstance.db.insert(budgets).values({
        id: "b1",
        scope: "global",
        monthlyLimitUsd: 100,
        alertThresholdPct: 80,
      }).run();

      testDbInstance.db.insert(costSnapshots).values({
        id: "c1",
        provider: "openai",
        date: monthStart,
        costUsd: 85,
      }).run();

      const result = await checkBudgets();
      expect(result[0].exceeded).toBe(false);
      expect(result[0].alertTriggered).toBe(true);
    });

    it("calculates per-user budget usage", async () => {
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

      const user = seedUser(testDbInstance.db, {
        id: "u1",
        oidcSub: "sub1",
        email: "user1@test.com",
      });

      testDbInstance.db.insert(budgets).values({
        id: "b1",
        scope: "user",
        scopeId: user.id,
        monthlyLimitUsd: 50,
        alertThresholdPct: 80,
      }).run();

      testDbInstance.db.insert(costSnapshots).values({
        id: "c1",
        provider: "openai",
        date: monthStart,
        userId: user.id,
        costUsd: 30,
      }).run();

      // Another user's cost should not count
      seedUser(testDbInstance.db, {
        id: "other-user",
        oidcSub: "sub-other",
        email: "other@test.com",
      });
      testDbInstance.db.insert(costSnapshots).values({
        id: "c2",
        provider: "openai",
        date: monthStart,
        userId: "other-user",
        costUsd: 999,
      }).run();

      const result = await checkBudgets();
      expect(result[0].currentSpendUsd).toBe(30);
      expect(result[0].usagePct).toBe(60);
    });
  });

  describe("deleteKeysForUser", () => {
    it("deletes all keys for a user from the database", async () => {
      const user = seedUser(testDbInstance.db, {
        id: "u1",
        oidcSub: "sub1",
        email: "user1@test.com",
      });

      testDbInstance.db.insert(apiKeys).values({
        id: "k1",
        userId: user.id,
        provider: "gemini",
        name: "test-key",
      }).run();

      await deleteKeysForUser(user.id);

      const remaining = testDbInstance.db
        .select()
        .from(apiKeys)
        .all();
      expect(remaining).toHaveLength(0);
    });

    it("calls provider revocation for each key", async () => {
      const { archiveKey } = await import("@/lib/providers/anthropic");

      const user = seedUser(testDbInstance.db, {
        id: "u1",
        oidcSub: "sub1",
        email: "user1@test.com",
      });

      testDbInstance.db.insert(apiKeys).values({
        id: "k1",
        userId: user.id,
        provider: "anthropic",
        name: "test-key",
        providerKeyId: "ant-key-id",
      }).run();

      testDbInstance.db.insert(anthropicKeyPool).values({
        id: "p1",
        anthropicKeyId: "ant-key-id",
        status: "assigned",
        assignedTo: user.id,
      }).run();

      await deleteKeysForUser(user.id);

      expect(archiveKey).toHaveBeenCalledWith("ant-key-id");
    });
  });

  describe("enforcebudgets", () => {
    it("deletes keys for users exceeding their budget", async () => {
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

      const user = seedUser(testDbInstance.db, {
        id: "u1",
        oidcSub: "sub1",
        email: "user1@test.com",
      });

      testDbInstance.db.insert(budgets).values({
        id: "b1",
        scope: "user",
        scopeId: user.id,
        monthlyLimitUsd: 10,
        alertThresholdPct: 80,
      }).run();

      testDbInstance.db.insert(costSnapshots).values({
        id: "c1",
        provider: "openai",
        date: monthStart,
        userId: user.id,
        costUsd: 15,
      }).run();

      testDbInstance.db.insert(apiKeys).values({
        id: "k1",
        userId: user.id,
        provider: "gemini",
        name: "test-key",
      }).run();

      const exceeded = await enforcebudgets();

      expect(exceeded).toHaveLength(1);
      expect(exceeded[0].exceeded).toBe(true);

      const remaining = testDbInstance.db
        .select()
        .from(apiKeys)
        .all();
      expect(remaining).toHaveLength(0);
    });

    it("does not delete keys for users within budget", async () => {
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

      const user = seedUser(testDbInstance.db, {
        id: "u1",
        oidcSub: "sub1",
        email: "user1@test.com",
      });

      testDbInstance.db.insert(budgets).values({
        id: "b1",
        scope: "user",
        scopeId: user.id,
        monthlyLimitUsd: 100,
        alertThresholdPct: 80,
      }).run();

      testDbInstance.db.insert(costSnapshots).values({
        id: "c1",
        provider: "openai",
        date: monthStart,
        userId: user.id,
        costUsd: 50,
      }).run();

      testDbInstance.db.insert(apiKeys).values({
        id: "k1",
        userId: user.id,
        provider: "gemini",
        name: "test-key",
      }).run();

      const exceeded = await enforcebudgets();
      expect(exceeded).toHaveLength(0);

      const remaining = testDbInstance.db
        .select()
        .from(apiKeys)
        .all();
      expect(remaining).toHaveLength(1);
    });
  });
});

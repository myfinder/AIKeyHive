import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, seedUser } from "@/__tests__/db-helper";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

const testDbInstance = createTestDb();
vi.mock("@/db", () => ({ db: testDbInstance.db }));

import { auth } from "@/auth";

describe("admin users API", () => {
  beforeEach(() => {
    testDbInstance.sqlite.exec("DELETE FROM users");
    vi.clearAllMocks();
  });

  describe("GET /api/admin/users", () => {
    it("returns 403 for non-admin", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "user@test.com", role: "user" },
        expires: "",
      });

      const { GET } = await import("@/app/api/admin/users/route");
      const res = await GET();
      expect(res.status).toBe(403);
    });

    it("returns users list for admin without oidcSub or openaiProjectId", async () => {
      seedUser(testDbInstance.db, {
        id: "u1",
        oidcSub: "sub1",
        email: "admin@test.com",
        role: "admin",
        openaiProjectId: "proj-secret-123",
      });

      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "admin@test.com", role: "admin" },
        expires: "",
      });

      const { GET } = await import("@/app/api/admin/users/route");
      const res = await GET();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(1);
      // Must NOT expose sensitive fields
      expect(body.data[0]).not.toHaveProperty("oidcSub");
      expect(body.data[0]).not.toHaveProperty("openaiProjectId");
      // Must include safe fields
      expect(body.data[0]).toHaveProperty("id");
      expect(body.data[0]).toHaveProperty("email");
      expect(body.data[0]).toHaveProperty("role");
    });
  });

  describe("PATCH /api/admin/users/[id]", () => {
    it("returns 403 for non-admin", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "user@test.com", role: "user" },
        expires: "",
      });

      const { PATCH } = await import("@/app/api/admin/users/[id]/route");
      const req = new Request("http://localhost/api/admin/users/u1", {
        method: "PATCH",
        body: JSON.stringify({ role: "admin" }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await PATCH(req as never, { params: Promise.resolve({ id: "u1" }) });
      expect(res.status).toBe(403);
    });

    it("prevents demotion of last admin", async () => {
      const admin = seedUser(testDbInstance.db, {
        id: "u1",
        oidcSub: "sub1",
        email: "admin@test.com",
        role: "admin",
      });

      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "admin@test.com", role: "admin" },
        expires: "",
      });

      const { PATCH } = await import("@/app/api/admin/users/[id]/route");
      const req = new Request("http://localhost/api/admin/users/u1", {
        method: "PATCH",
        body: JSON.stringify({ role: "user" }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await PATCH(req as never, { params: Promise.resolve({ id: admin.id }) });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain("last admin");
    });

    it("allows demotion when multiple admins exist", async () => {
      seedUser(testDbInstance.db, {
        id: "u1",
        oidcSub: "sub1",
        email: "admin1@test.com",
        role: "admin",
      });
      seedUser(testDbInstance.db, {
        id: "u2",
        oidcSub: "sub2",
        email: "admin2@test.com",
        role: "admin",
      });

      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "admin1@test.com", role: "admin" },
        expires: "",
      });

      const { PATCH } = await import("@/app/api/admin/users/[id]/route");
      const req = new Request("http://localhost/api/admin/users/u1", {
        method: "PATCH",
        body: JSON.stringify({ role: "user" }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await PATCH(req as never, { params: Promise.resolve({ id: "u1" }) });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.role).toBe("user");
      // Must NOT expose sensitive fields
      expect(body.data).not.toHaveProperty("oidcSub");
      expect(body.data).not.toHaveProperty("openaiProjectId");
    });

    it("returns 404 for non-existent user", async () => {
      seedUser(testDbInstance.db, {
        id: "u1",
        oidcSub: "sub1",
        email: "admin@test.com",
        role: "admin",
      });

      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "admin@test.com", role: "admin" },
        expires: "",
      });

      const { PATCH } = await import("@/app/api/admin/users/[id]/route");
      const req = new Request("http://localhost/api/admin/users/nonexistent", {
        method: "PATCH",
        body: JSON.stringify({ role: "admin" }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await PATCH(req as never, {
        params: Promise.resolve({ id: "nonexistent" }),
      });
      expect(res.status).toBe(404);
    });
  });
});

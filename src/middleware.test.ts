import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock next-auth/jwt
vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn(),
}));

// Mock next/server
vi.mock("next/server", () => {
  class MockNextResponse {
    status: number;
    body: unknown;
    headers: Map<string, string>;

    constructor(body: string | null, init?: { status?: number; headers?: Record<string, string> }) {
      this.body = body;
      this.status = init?.status || 200;
      this.headers = new Map(Object.entries(init?.headers || {}));
    }

    static json(data: unknown, init?: { status?: number }) {
      const resp = new MockNextResponse(JSON.stringify(data), init);
      resp.body = data;
      return resp;
    }

    static next() {
      return new MockNextResponse(null, { status: 200 });
    }

    static redirect(url: URL) {
      const resp = new MockNextResponse(null, { status: 307 });
      (resp as Record<string, unknown>).redirectUrl = url.pathname;
      return resp;
    }
  }

  return { NextResponse: MockNextResponse };
});

import { getToken } from "next-auth/jwt";
import { middleware } from "@/middleware";

function createMockRequest(pathname: string, headers: Record<string, string> = {}) {
  return {
    nextUrl: {
      pathname,
    },
    url: `http://localhost:3000${pathname}`,
    headers: {
      get: (key: string) => headers[key.toLowerCase()] || null,
    },
  } as unknown as Parameters<typeof middleware>[0];
}

describe("middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-cron-secret";
    process.env.AUTH_SECRET = "test-auth-secret";
  });

  describe("public routes", () => {
    it("allows / without auth", async () => {
      const res = await middleware(createMockRequest("/"));
      expect(res.status).toBe(200);
    });

    it("allows /api/auth paths", async () => {
      const res = await middleware(createMockRequest("/api/auth/callback"));
      expect(res.status).toBe(200);
    });

    it("allows /_next paths", async () => {
      const res = await middleware(createMockRequest("/_next/static/chunk.js"));
      expect(res.status).toBe(200);
    });

    it("allows /favicon.ico", async () => {
      const res = await middleware(createMockRequest("/favicon.ico"));
      expect(res.status).toBe(200);
    });
  });

  describe("cron routes", () => {
    it("rejects cron without authorization header", async () => {
      const res = await middleware(createMockRequest("/api/cron/sync-costs"));
      expect(res.status).toBe(401);
    });

    it("rejects cron with wrong secret", async () => {
      const res = await middleware(
        createMockRequest("/api/cron/sync-costs", {
          authorization: "Bearer wrong-secret",
        })
      );
      expect(res.status).toBe(401);
    });

    it("accepts cron with correct secret", async () => {
      const res = await middleware(
        createMockRequest("/api/cron/sync-costs", {
          authorization: "Bearer test-cron-secret",
        })
      );
      expect(res.status).toBe(200);
    });

    it("rejects Bearer undefined when CRON_SECRET is unset", async () => {
      delete process.env.CRON_SECRET;
      const res = await middleware(
        createMockRequest("/api/cron/sync-costs", {
          authorization: "Bearer undefined",
        })
      );
      expect(res.status).toBe(500);
    });

    it("returns 500 when CRON_SECRET is not configured", async () => {
      delete process.env.CRON_SECRET;
      const res = await middleware(createMockRequest("/api/cron/sync-costs"));
      expect(res.status).toBe(500);
    });
  });

  describe("authenticated routes", () => {
    it("returns 401 for API routes without token", async () => {
      vi.mocked(getToken).mockResolvedValue(null);
      const res = await middleware(createMockRequest("/api/keys"));
      expect(res.status).toBe(401);
    });

    it("redirects page routes without token to /", async () => {
      vi.mocked(getToken).mockResolvedValue(null);
      const res = await middleware(createMockRequest("/dashboard"));
      expect(res.status).toBe(307);
      expect((res as Record<string, unknown>).redirectUrl).toBe("/");
    });

    it("allows authenticated user to access /api/keys", async () => {
      vi.mocked(getToken).mockResolvedValue({
        id: "u1",
        role: "user",
      } as ReturnType<typeof getToken> extends Promise<infer T> ? T : never);
      const res = await middleware(createMockRequest("/api/keys"));
      expect(res.status).toBe(200);
    });
  });

  describe("admin routes", () => {
    it("blocks non-admin from /api/admin/*", async () => {
      vi.mocked(getToken).mockResolvedValue({
        id: "u1",
        role: "user",
      } as ReturnType<typeof getToken> extends Promise<infer T> ? T : never);
      const res = await middleware(createMockRequest("/api/admin/users"));
      expect(res.status).toBe(403);
    });

    it("allows admin to access /api/admin/*", async () => {
      vi.mocked(getToken).mockResolvedValue({
        id: "u1",
        role: "admin",
      } as ReturnType<typeof getToken> extends Promise<infer T> ? T : never);
      const res = await middleware(createMockRequest("/api/admin/users"));
      expect(res.status).toBe(200);
    });

    it("blocks non-admin from /costs page", async () => {
      vi.mocked(getToken).mockResolvedValue({
        id: "u1",
        role: "user",
      } as ReturnType<typeof getToken> extends Promise<infer T> ? T : never);
      const res = await middleware(createMockRequest("/costs"));
      expect(res.status).toBe(307);
    });

    it("redirects non-admin page access to /dashboard", async () => {
      vi.mocked(getToken).mockResolvedValue({
        id: "u1",
        role: "user",
      } as ReturnType<typeof getToken> extends Promise<infer T> ? T : never);
      const res = await middleware(createMockRequest("/admin"));
      expect((res as Record<string, unknown>).redirectUrl).toBe("/dashboard");
    });
  });

  describe("case-sensitivity bypass prevention", () => {
    it("blocks /API/ADMIN/users for non-admin", async () => {
      vi.mocked(getToken).mockResolvedValue({
        id: "u1",
        role: "user",
      } as ReturnType<typeof getToken> extends Promise<infer T> ? T : never);
      const res = await middleware(createMockRequest("/API/ADMIN/users"));
      expect(res.status).toBe(403);
    });

    it("blocks /Admin for non-admin", async () => {
      vi.mocked(getToken).mockResolvedValue({
        id: "u1",
        role: "user",
      } as ReturnType<typeof getToken> extends Promise<infer T> ? T : never);
      const res = await middleware(createMockRequest("/Admin"));
      expect(res.status).toBe(307);
    });

    it("blocks /API/Cron without secret header", async () => {
      // CRON_SECRET is set, so missing header returns 401
      const res = await middleware(createMockRequest("/API/Cron/sync-costs"));
      expect(res.status).toBe(401);
    });
  });

  describe("timing-safe comparison", () => {
    it("rejects secrets of different length", async () => {
      const res = await middleware(
        createMockRequest("/api/cron/sync-costs", {
          authorization: "Bearer x",
        })
      );
      expect(res.status).toBe(401);
    });

    it("rejects secrets that are similar but not identical", async () => {
      const res = await middleware(
        createMockRequest("/api/cron/sync-costs", {
          authorization: "Bearer test-cron-secrex",
        })
      );
      expect(res.status).toBe(401);
    });
  });
});

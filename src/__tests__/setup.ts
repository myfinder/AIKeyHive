import { vi } from "vitest";

// Provide default env vars for tests
process.env.AUTH_SECRET = "test-secret";
process.env.CRON_SECRET = "test-cron-secret";
process.env.DATABASE_URL = "file::memory:";

// Mock next-auth
vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

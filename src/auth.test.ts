import { beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("@/auth");

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({
    handlers: {},
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  })),
}));

vi.mock("next-auth/providers/okta", () => ({
  default: vi.fn((config) => ({ id: "okta", config })),
}));

describe("auth configuration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("does not register an OIDC provider when provider env vars are missing", async () => {
    vi.stubEnv("AUTH_OIDC_ISSUER", "");
    vi.stubEnv("AUTH_OIDC_CLIENT_ID", "");
    vi.stubEnv("AUTH_OIDC_CLIENT_SECRET", "");

    const { authConfig } = await import("@/auth");

    expect(authConfig.providers).toEqual([]);
  });
});

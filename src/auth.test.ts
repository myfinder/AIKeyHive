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

vi.mock("next-auth/providers/credentials", () => ({
  default: vi.fn((config) => ({ id: "dev", config })),
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

  it("registers a development credentials provider only when explicitly enabled", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_OIDC_ISSUER", "");
    vi.stubEnv("AUTH_OIDC_CLIENT_ID", "");
    vi.stubEnv("AUTH_OIDC_CLIENT_SECRET", "");
    vi.stubEnv("AUTH_DEV_LOGIN", "true");

    const { authConfig } = await import("@/auth");

    expect(authConfig.providers).toHaveLength(1);
    expect(authConfig.providers?.[0]).toMatchObject({ id: "dev" });
  });
});

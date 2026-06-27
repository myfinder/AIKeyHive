import { describe, expect, it } from "vitest";
import {
  createProxyKeySecret,
  hashProxyKeySecret,
  keyHint,
} from "@/lib/proxy/key";

describe("proxy key helpers", () => {
  it("creates an akp-prefixed secret with enough entropy", () => {
    const secret = createProxyKeySecret();

    expect(secret.startsWith("akp_")).toBe(true);
    expect(secret.length).toBeGreaterThan(40);
  });

  it("returns a safe display hint", () => {
    const secret = createProxyKeySecret();

    expect(keyHint(secret)).toMatch(/^akp_\.\.\.[A-Za-z0-9_-]{6}$/);
  });

  it("hashes secrets deterministically without including the raw secret", () => {
    const secret = createProxyKeySecret();
    const hashA = hashProxyKeySecret(secret);
    const hashB = hashProxyKeySecret(secret);

    expect(hashA).toBe(hashB);
    expect(hashA).not.toContain(secret);
  });
});

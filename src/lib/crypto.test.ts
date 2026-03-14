import { describe, it, expect, vi, beforeEach } from "vitest";

describe("crypto", () => {
  beforeEach(() => {
    // Set a valid 32-byte hex key for tests
    process.env.KEY_ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  });

  describe("encrypt / decrypt", () => {
    it("round-trips a string correctly", async () => {
      const { encrypt, decrypt } = await import("@/lib/crypto");
      const plaintext = "sk-ant-api03-test-key-value-1234567890";
      const encrypted = encrypt(plaintext);
      expect(encrypted).not.toBe(plaintext);
      expect(encrypted).toContain(":");
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it("produces different ciphertexts for the same input (random IV)", async () => {
      const { encrypt } = await import("@/lib/crypto");
      const plaintext = "sk-ant-api03-same-key";
      const a = encrypt(plaintext);
      const b = encrypt(plaintext);
      expect(a).not.toBe(b);
    });

    it("throws on tampered ciphertext", async () => {
      const { encrypt, decrypt } = await import("@/lib/crypto");
      const encrypted = encrypt("test-value");
      const parts = encrypted.split(":");
      // Tamper with ciphertext
      parts[2] = "00" + parts[2].slice(2);
      expect(() => decrypt(parts.join(":"))).toThrow();
    });

    it("throws when KEY_ENCRYPTION_KEY is not set", async () => {
      delete process.env.KEY_ENCRYPTION_KEY;
      vi.resetModules();
      const { encrypt } = await import("@/lib/crypto");
      expect(() => encrypt("test")).toThrow("KEY_ENCRYPTION_KEY");
    });

    it("throws when KEY_ENCRYPTION_KEY is wrong length", async () => {
      process.env.KEY_ENCRYPTION_KEY = "tooshort";
      vi.resetModules();
      const { encrypt } = await import("@/lib/crypto");
      expect(() => encrypt("test")).toThrow("KEY_ENCRYPTION_KEY");
    });
  });

  describe("hashKey", () => {
    it("produces consistent hash for same input", async () => {
      const { hashKey } = await import("@/lib/crypto");
      const a = hashKey("sk-ant-api03-test");
      const b = hashKey("sk-ant-api03-test");
      expect(a).toBe(b);
    });

    it("produces different hashes for different inputs", async () => {
      const { hashKey } = await import("@/lib/crypto");
      const a = hashKey("sk-ant-api03-key1");
      const b = hashKey("sk-ant-api03-key2");
      expect(a).not.toBe(b);
    });

    it("returns a 64-char hex string", async () => {
      const { hashKey } = await import("@/lib/crypto");
      const hash = hashKey("test");
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});

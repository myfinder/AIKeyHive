import { describe, it, expect } from "vitest";
import { extractKeyId } from "@/lib/providers/gemini";

describe("gemini provider", () => {
  describe("extractKeyId", () => {
    it("extracts key ID from full resource name", () => {
      const name = "projects/my-project/locations/global/keys/abc123";
      expect(extractKeyId(name)).toBe("abc123");
    });

    it("returns original string if no slashes", () => {
      expect(extractKeyId("abc123")).toBe("abc123");
    });

    it("handles trailing slash edge case", () => {
      // pop() returns "" for trailing slash, but || falls back to original
      const name = "projects/my-project/locations/global/keys/";
      expect(extractKeyId(name)).toBe(name);
    });
  });
});

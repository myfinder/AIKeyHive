import { describe, it, expect, vi, beforeEach } from "vitest";

describe("gemini costs", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  describe("BigQuery table name validation", () => {
    it("rejects table names with SQL injection characters", async () => {
      vi.stubEnv("BIGQUERY_BILLING_TABLE", "table; DROP TABLE users--");

      const { fetchCosts } = await import("@/lib/costs/gemini");
      await expect(fetchCosts("2024-01-01", "2024-01-31")).rejects.toThrow(
        "Invalid BIGQUERY_BILLING_TABLE format"
      );
    });

    it("accepts valid table names", () => {
      const valid = "project.dataset.billing_export_v1";
      expect(/^[a-zA-Z0-9._-]+$/.test(valid)).toBe(true);
    });

    it("rejects table names with backticks", () => {
      const invalid = "`project.dataset.table`";
      expect(/^[a-zA-Z0-9._-]+$/.test(invalid)).toBe(false);
    });

    it("returns empty array when BIGQUERY_BILLING_TABLE is not set", async () => {
      vi.stubEnv("BIGQUERY_BILLING_TABLE", "");
      // Re-import to get fresh module
      vi.resetModules();
      const { fetchCosts } = await import("@/lib/costs/gemini");
      const result = await fetchCosts("2024-01-01", "2024-01-31");
      expect(result).toEqual([]);
    });
  });
});

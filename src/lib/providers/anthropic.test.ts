import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchLastUsedByApiKey } from "@/lib/providers/anthropic";

function usageResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

describe("fetchLastUsedByApiKey", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_ADMIN_KEY", "sk-ant-admin-test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns the latest bucket date with usage per api key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        usageResponse({
          data: [
            {
              starting_at: "2026-06-01T00:00:00Z",
              ending_at: "2026-06-02T00:00:00Z",
              results: [
                { api_key_id: "key_a", uncached_input_tokens: 10, output_tokens: 5 },
                { api_key_id: "key_b", uncached_input_tokens: 1, output_tokens: 0 },
              ],
            },
            {
              starting_at: "2026-06-05T00:00:00Z",
              ending_at: "2026-06-06T00:00:00Z",
              results: [
                { api_key_id: "key_a", uncached_input_tokens: 3, output_tokens: 2 },
              ],
            },
          ],
          has_more: false,
        })
      )
    );

    const map = await fetchLastUsedByApiKey();
    expect(map.get("key_a")).toBe("2026-06-05T00:00:00Z");
    expect(map.get("key_b")).toBe("2026-06-01T00:00:00Z");
  });

  it("ignores zero-usage results and null api_key_id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        usageResponse({
          data: [
            {
              starting_at: "2026-06-03T00:00:00Z",
              ending_at: "2026-06-04T00:00:00Z",
              results: [
                { api_key_id: "key_zero", uncached_input_tokens: 0, output_tokens: 0 },
                { api_key_id: null, uncached_input_tokens: 100, output_tokens: 50 },
              ],
            },
          ],
          has_more: false,
        })
      )
    );

    const map = await fetchLastUsedByApiKey();
    expect(map.size).toBe(0);
  });

  it("follows pagination via next_page", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        usageResponse({
          data: [
            {
              starting_at: "2026-06-01T00:00:00Z",
              ending_at: "2026-06-02T00:00:00Z",
              results: [
                { api_key_id: "key_a", uncached_input_tokens: 1, output_tokens: 0 },
              ],
            },
          ],
          has_more: true,
          next_page: "page_xyz",
        })
      )
      .mockResolvedValueOnce(
        usageResponse({
          data: [
            {
              starting_at: "2026-06-07T00:00:00Z",
              ending_at: "2026-06-08T00:00:00Z",
              results: [
                { api_key_id: "key_a", uncached_input_tokens: 2, output_tokens: 0 },
              ],
            },
          ],
          has_more: false,
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const map = await fetchLastUsedByApiKey();
    expect(map.get("key_a")).toBe("2026-06-07T00:00:00Z");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondUrl = fetchMock.mock.calls[1][0] as string;
    expect(secondUrl).toContain("page=page_xyz");
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403 } as Response)
    );
    await expect(fetchLastUsedByApiKey()).rejects.toThrow(
      "Anthropic fetchLastUsedByApiKey failed: 403"
    );
  });
});

import {
  proxyKeysBadgeLabel,
  proxyKeysDescription,
} from "@/lib/proxy/dashboard-copy";

describe("proxy keys dashboard copy", () => {
  it("positions proxy keys for development cost guard use", () => {
    expect(proxyKeysBadgeLabel).toBe("For Development");
    expect(proxyKeysDescription).toContain("development");
    expect(proxyKeysDescription).toContain("experiments");
    expect(proxyKeysDescription).toContain("runaway spend");
  });
});

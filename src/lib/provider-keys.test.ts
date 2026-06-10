import { describe, it, expect } from "vitest";
import {
  reconcileOpenAIKeys,
  reconcileAnthropicKeys,
  reconcileGeminiKeys,
} from "./provider-keys";
import type { OpenAIProjectApiKey } from "@/lib/providers/openai";

describe("reconcileOpenAIKeys", () => {
  const projects = [
    { id: "proj_1", name: "aikeyhive-alice@example.com" },
    { id: "proj_2", name: "legacy-project" },
  ];

  const saKey: OpenAIProjectApiKey = {
    id: "key_sa1",
    name: "my-key",
    redacted_value: "sk-...abcd",
    created_at: 1750000000,
    owner: { type: "service_account", service_account: { id: "sa_1" } },
  };
  const userKey: OpenAIProjectApiKey = {
    id: "key_u1",
    name: "bobs-key",
    redacted_value: "sk-...wxyz",
    owner: {
      type: "user",
      user: { id: "user-1", email: "bob@example.com" },
    },
  };

  it("marks keys managed when service account id matches DB", () => {
    const entries = reconcileOpenAIKeys(
      projects,
      { proj_1: [saKey], proj_2: [] },
      [{ providerKeyId: "sa_1", keyName: "my-key", ownerEmail: "alice@example.com" }]
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].managed).toBe(true);
    expect(entries[0].ownerEmail).toBe("alice@example.com");
    expect(entries[0].location).toBe("aikeyhive-alice@example.com");
    expect(entries[0].openai).toEqual({
      projectId: "proj_1",
      ownerType: "service_account",
      serviceAccountId: "sa_1",
    });
  });

  it("marks user-owned and unknown keys as unmanaged", () => {
    const entries = reconcileOpenAIKeys(
      projects,
      { proj_1: [saKey], proj_2: [userKey] },
      []
    );
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => !e.managed)).toBe(true);
    const user = entries.find((e) => e.keyId === "key_u1")!;
    expect(user.ownerEmail).toBe("bob@example.com");
    expect(user.openai?.ownerType).toBe("user");
    expect(user.openai?.serviceAccountId).toBeUndefined();
  });

  it("converts created_at epoch seconds to ISO string", () => {
    const entries = reconcileOpenAIKeys(projects, { proj_1: [saKey] }, []);
    expect(entries[0].createdAt).toBe(
      new Date(1750000000 * 1000).toISOString()
    );
  });
});

describe("reconcileAnthropicKeys", () => {
  const orgKeys = [
    {
      id: "apikey_1",
      name: "pool-key",
      partial_key_hint: "sk-ant-...1234",
      workspace_id: "ws_1",
      status: "active" as const,
    },
    {
      id: "apikey_2",
      name: "rogue-key",
      partial_key_hint: "sk-ant-...9999",
      workspace_id: null,
      status: "active" as const,
    },
  ];

  it("marks keys in the pool as managed with assignee email", () => {
    const entries = reconcileAnthropicKeys(orgKeys, [
      { anthropicKeyId: "apikey_1", assignedToEmail: "alice@example.com" },
    ]);
    const managed = entries.find((e) => e.keyId === "apikey_1")!;
    expect(managed.managed).toBe(true);
    expect(managed.ownerEmail).toBe("alice@example.com");
    expect(managed.location).toBe("ws_1");
  });

  it("marks org keys outside the pool as unmanaged", () => {
    const entries = reconcileAnthropicKeys(orgKeys, [
      { anthropicKeyId: "apikey_1", assignedToEmail: null },
    ]);
    const rogue = entries.find((e) => e.keyId === "apikey_2")!;
    expect(rogue.managed).toBe(false);
    expect(rogue.ownerEmail).toBeNull();
    expect(rogue.location).toBe("(default workspace)");
  });

  it("treats unassigned pool keys as managed without owner", () => {
    const entries = reconcileAnthropicKeys(orgKeys, [
      { anthropicKeyId: "apikey_1", assignedToEmail: null },
    ]);
    const managed = entries.find((e) => e.keyId === "apikey_1")!;
    expect(managed.managed).toBe(true);
    expect(managed.ownerEmail).toBeNull();
  });
});

describe("lastUsedAt reconciliation", () => {
  it("maps OpenAI last_used_at (unix seconds) to ISO string", () => {
    const entries = reconcileOpenAIKeys(
      [{ id: "proj_1", name: "Project One" }],
      {
        proj_1: [
          {
            id: "key_1",
            name: "k",
            redacted_value: "sk-...abcd",
            created_at: 1700000000,
            last_used_at: 1765000000,
            owner: { type: "service_account", service_account: { id: "sa_1" } },
          },
        ],
      },
      []
    );
    expect(entries[0].lastUsedAt).toBe(
      new Date(1765000000 * 1000).toISOString()
    );
  });

  it("sets OpenAI lastUsedAt null when absent", () => {
    const entries = reconcileOpenAIKeys(
      [{ id: "proj_1", name: "Project One" }],
      { proj_1: [{ id: "key_1", name: "k", redacted_value: "sk-...abcd" }] },
      []
    );
    expect(entries[0].lastUsedAt).toBeNull();
  });

  it("attaches Anthropic lastUsedAt from the usage map", () => {
    const entries = reconcileAnthropicKeys(
      [
        {
          id: "ak_1",
          name: "a",
          partial_key_hint: "...aaaa",
          workspace_id: null,
          status: "active" as const,
        },
        {
          id: "ak_2",
          name: "b",
          partial_key_hint: "...bbbb",
          workspace_id: null,
          status: "active" as const,
        },
      ],
      [],
      new Map([["ak_1", "2026-06-05T00:00:00Z"]])
    );
    expect(entries[0].lastUsedAt).toBe("2026-06-05T00:00:00Z");
    expect(entries[1].lastUsedAt).toBeNull();
  });
});

describe("reconcileGeminiKeys", () => {
  const gcpKeys = [
    {
      name: "projects/my-proj/locations/global/keys/key-1",
      uid: "uid-1",
      displayName: "aikeyhive-alice@example.com-dev",
      createTime: "2026-06-01T00:00:00Z",
    },
    {
      name: "projects/my-proj/locations/global/keys/key-2",
      uid: "uid-2",
      displayName: "manually-created",
      createTime: "2026-05-01T00:00:00Z",
    },
  ];

  it("matches DB rows by key id extracted from resource name", () => {
    const entries = reconcileGeminiKeys(
      gcpKeys,
      [{ providerKeyId: "key-1", keyName: "dev", ownerEmail: "alice@example.com" }],
      "my-proj"
    );
    const managed = entries.find((e) => e.keyId === "key-1")!;
    expect(managed.managed).toBe(true);
    expect(managed.ownerEmail).toBe("alice@example.com");
    const rogue = entries.find((e) => e.keyId === "key-2")!;
    expect(rogue.managed).toBe(false);
    expect(rogue.location).toBe("my-proj");
    expect(rogue.createdAt).toBe("2026-05-01T00:00:00Z");
  });
});

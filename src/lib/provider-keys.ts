import type { OpenAIProject, OpenAIProjectApiKey } from "@/lib/providers/openai";
import type { AnthropicApiKey } from "@/lib/providers/anthropic";
import type { GcpApiKey } from "@/lib/providers/gemini";
import { extractKeyId } from "@/lib/providers/gemini";

export type Provider = "openai" | "anthropic" | "gemini";

export interface ProviderKeyEntry {
  provider: Provider;
  keyId: string;
  name: string | null;
  hint: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
  /** Where the key lives: OpenAI project name, Anthropic workspace id, GCP project id */
  location: string;
  managed: boolean;
  ownerEmail: string | null;
  /** Extra fields required to delete an unmanaged OpenAI key */
  openai?: {
    projectId: string;
    ownerType: "user" | "service_account";
    serviceAccountId?: string;
  };
}

export interface ManagedKeyRow {
  providerKeyId: string | null;
  keyName: string | null;
  ownerEmail: string | null;
}

export interface PoolKeyRow {
  anthropicKeyId: string;
  assignedToEmail: string | null;
}

/** OpenAI redacted values can be ~50 chars of asterisks — keep first 12 + last 4 */
function snipHint(hint: string | null): string | null {
  if (!hint || hint.length <= 16) return hint;
  return `${hint.slice(0, 12)}…${hint.slice(-4)}`;
}

export function reconcileOpenAIKeys(
  projects: OpenAIProject[],
  keysByProject: Record<string, OpenAIProjectApiKey[]>,
  dbRows: ManagedKeyRow[]
): ProviderKeyEntry[] {
  const managedByServiceAccount = new Map(
    dbRows
      .filter((r) => r.providerKeyId)
      .map((r) => [r.providerKeyId as string, r])
  );

  return projects.flatMap((project) =>
    (keysByProject[project.id] || []).map((key) => {
      const serviceAccountId = key.owner?.service_account?.id;
      const managedRow = serviceAccountId
        ? managedByServiceAccount.get(serviceAccountId)
        : undefined;
      return {
        provider: "openai" as const,
        keyId: key.id,
        name: key.name || managedRow?.keyName || null,
        hint: snipHint(key.redacted_value || null),
        createdAt: key.created_at
          ? new Date(key.created_at * 1000).toISOString()
          : null,
        lastUsedAt: key.last_used_at
          ? new Date(key.last_used_at * 1000).toISOString()
          : null,
        location: project.name,
        managed: !!managedRow,
        ownerEmail: managedRow?.ownerEmail || key.owner?.user?.email || null,
        openai: {
          projectId: project.id,
          ownerType: key.owner?.type === "user" ? "user" : "service_account",
          ...(serviceAccountId ? { serviceAccountId } : {}),
        },
      };
    })
  );
}

export function reconcileAnthropicKeys(
  orgKeys: AnthropicApiKey[],
  poolRows: PoolKeyRow[],
  lastUsedById: Map<string, string> = new Map()
): ProviderKeyEntry[] {
  const poolById = new Map(poolRows.map((r) => [r.anthropicKeyId, r]));

  return orgKeys.map((key) => {
    const poolRow = poolById.get(key.id);
    return {
      provider: "anthropic" as const,
      keyId: key.id,
      name: key.name || null,
      hint: key.partial_key_hint || null,
      createdAt: null,
      lastUsedAt: lastUsedById.get(key.id) || null,
      location: key.workspace_id || "(default workspace)",
      managed: !!poolRow,
      ownerEmail: poolRow?.assignedToEmail || null,
    };
  });
}

export function reconcileGeminiKeys(
  gcpKeys: GcpApiKey[],
  dbRows: ManagedKeyRow[],
  gcpProjectId: string
): ProviderKeyEntry[] {
  const managedById = new Map(
    dbRows
      .filter((r) => r.providerKeyId)
      .map((r) => [r.providerKeyId as string, r])
  );

  return gcpKeys.map((key) => {
    const keyId = extractKeyId(key.name);
    const managedRow = managedById.get(keyId);
    return {
      provider: "gemini" as const,
      keyId,
      name: key.displayName || null,
      hint: null,
      createdAt: key.createTime || null,
      lastUsedAt: null,
      location: gcpProjectId,
      managed: !!managedRow,
      ownerEmail: managedRow?.ownerEmail || null,
    };
  });
}

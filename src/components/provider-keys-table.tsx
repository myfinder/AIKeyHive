"use client";

import { useState } from "react";
import { useAdminProviderKeys } from "@/hooks/use-keys";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { ProviderKeyEntry, Provider } from "@/lib/provider-keys";

const providerLabels: Record<Provider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
};

export function ProviderKeysTable({ provider }: { provider: Provider }) {
  const { keys, error, isLoading, mutate } = useAdminProviderKeys(provider);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(entry: ProviderKeyEntry) {
    const action =
      provider === "anthropic" ? "deactivated on Anthropic" : "permanently deleted";
    if (
      !confirm(
        `This key is not managed by AIKeyHive and will be ${action}. Continue?`
      )
    )
      return;

    setDeletingId(entry.keyId);
    try {
      const res = await fetch(`/api/admin/provider-keys/${provider}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyId: entry.keyId,
          projectId: entry.openai?.projectId,
          ownerType: entry.openai?.ownerType,
          serviceAccountId: entry.openai?.serviceAccountId,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed");
      }
      toast.success("Key deleted");
      mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete key");
    } finally {
      setDeletingId(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-24 items-center justify-center text-muted-foreground">
        Loading {providerLabels[provider]} keys...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-24 items-center justify-center text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (keys.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center text-muted-foreground">
        No keys found on {providerLabels[provider]}.
      </div>
    );
  }

  const unmanagedCount = keys.filter((k: ProviderKeyEntry) => !k.managed).length;

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        {keys.length} keys / {unmanagedCount} unmanaged
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Hint</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Last Used</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>User</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys.map((entry: ProviderKeyEntry) => (
            <TableRow key={entry.keyId}>
              <TableCell className="text-sm">{entry.name || "—"}</TableCell>
              <TableCell className="font-mono text-sm text-muted-foreground">
                {entry.hint || "—"}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {entry.location}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {entry.createdAt
                  ? new Date(entry.createdAt).toLocaleDateString()
                  : "—"}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {entry.lastUsedAt
                  ? new Date(entry.lastUsedAt).toLocaleDateString()
                  : "—"}
              </TableCell>
              <TableCell>
                {entry.managed ? (
                  <Badge variant="secondary" className="bg-green-100 text-green-800">
                    managed
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
                    unmanaged
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-sm">{entry.ownerEmail || "—"}</TableCell>
              <TableCell className="text-right">
                {!entry.managed && (
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={deletingId === entry.keyId}
                    onClick={() => handleDelete(entry)}
                  >
                    {deletingId === entry.keyId ? "Deleting..." : "Delete"}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

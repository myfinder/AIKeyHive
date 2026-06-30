"use client";

import { useKeys } from "@/hooks/use-keys";
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

const providerColors: Record<string, string> = {
  openai: "bg-green-100 text-green-800",
  anthropic: "bg-orange-100 text-orange-800",
  gemini: "bg-blue-100 text-blue-800",
};

const EXPIRING_SOON_MS = 7 * 24 * 60 * 60 * 1000;

export function KeyTable() {
  const { keys, isLoading, mutate } = useKeys();

  async function handleDelete(id: string) {
    if (!confirm("This key will be permanently deleted. Continue?")) return;
    try {
      const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      toast.success("Key deleted");
      mutate();
    } catch {
      toast.error("Failed to delete key");
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        Loading direct keys...
      </div>
    );
  }

  if (keys.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        No direct keys yet. Create one for tools that require provider
        credentials.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Provider</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Key Hint</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Expires</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Last Used</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {keys.map((key) => {
          const status = displayStatus(key);

          return (
            <TableRow key={key.id}>
              <TableCell>
                <Badge variant="secondary" className={providerColors[key.provider]}>
                  {key.provider}
                </Badge>
              </TableCell>
              <TableCell className="text-sm">{key.name || "—"}</TableCell>
              <TableCell className="font-mono text-sm text-muted-foreground">
                {key.keyHint || "—"}
              </TableCell>
              <TableCell>
                <Badge
                  variant="secondary"
                  className={status.className}
                  title={key.revocationError || undefined}
                >
                  {status.label}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatExpires(key.expiresAt)}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatDate(key.createdAt)}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatDate(key.lastUsedAt)}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDelete(key.id)}
                >
                  Delete
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function displayStatus(key: {
  status: "active" | "expired" | "revocation_failed";
  expiresAt: string | null;
}) {
  if (key.status === "revocation_failed") {
    return {
      label: "Revocation failed",
      className: "bg-red-100 text-red-800",
    };
  }

  const expiresAt = key.expiresAt ? Date.parse(key.expiresAt) : null;
  if (key.status === "expired" || (expiresAt !== null && expiresAt <= Date.now())) {
    return {
      label: "Expired",
      className: "bg-slate-100 text-slate-700",
    };
  }

  if (expiresAt !== null && expiresAt - Date.now() <= EXPIRING_SOON_MS) {
    return {
      label: "Expires soon",
      className: "bg-amber-100 text-amber-800",
    };
  }

  return {
    label: "Active",
    className: "bg-emerald-100 text-emerald-800",
  };
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

function formatExpires(value: string | null) {
  if (!value) return "No expiration";
  return new Date(value).toLocaleDateString();
}

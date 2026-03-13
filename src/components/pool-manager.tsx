"use client";

import { useState } from "react";
import { useAdminPool } from "@/hooks/use-keys";
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

export function PoolManager() {
  const { pool, isLoading, mutate } = useAdminPool();
  const [syncing, setSyncing] = useState(false);

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/admin/pool/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Synced ${data.synced} keys, ${data.added} new`);
      mutate();
    } catch {
      toast.error("Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        Loading pool...
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    available: "default",
    assigned: "secondary",
    disabled: "destructive",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {pool.filter((k: { status: string }) => k.status === "available").length} available
          {" / "}
          {pool.length} total
        </div>
        <Button onClick={handleSync} disabled={syncing} variant="outline">
          {syncing ? "Syncing..." : "Sync from Anthropic"}
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Key ID</TableHead>
            <TableHead>Hint</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Assigned To</TableHead>
            <TableHead>Assigned At</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pool.map(
            (key: {
              id: string;
              anthropicKeyId: string;
              keyHint: string | null;
              status: string;
              assignedTo: string | null;
              assignedAt: string | null;
            }) => (
              <TableRow key={key.id}>
                <TableCell className="font-mono text-xs">
                  {key.anthropicKeyId.slice(0, 12)}...
                </TableCell>
                <TableCell className="font-mono text-sm">
                  {key.keyHint || "—"}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      statusColors[key.status] as
                        | "default"
                        | "secondary"
                        | "destructive"
                    }
                  >
                    {key.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">
                  {key.assignedTo || "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {key.assignedAt
                    ? new Date(key.assignedAt).toLocaleDateString()
                    : "—"}
                </TableCell>
              </TableRow>
            )
          )}
        </TableBody>
      </Table>
    </div>
  );
}

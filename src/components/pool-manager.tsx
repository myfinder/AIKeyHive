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
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface PoolKey {
  id: string;
  keyHint: string | null;
  status: string;
  assignedTo: string | null;
  assignedToEmail: string | null;
  assignedAt: string | null;
}


function AddKeyForm({ onAdded }: { onAdded: () => void }) {
  const [keyValue, setKeyValue] = useState("");
  const [adding, setAdding] = useState(false);

  async function handleAdd() {
    const trimmed = keyValue.trim();
    if (!trimmed) return;

    setAdding(true);
    try {
      const res = await fetch("/api/admin/pool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyValue: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed");
      }
      toast.success("Key added to pool");
      setKeyValue("");
      onAdded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add key");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        type="password"
        placeholder="sk-ant-api03-..."
        value={keyValue}
        onChange={(e) => setKeyValue(e.target.value)}
        className="w-80"
      />
      <Button onClick={handleAdd} disabled={adding || !keyValue.trim()}>
        {adding ? "Adding..." : "Add Key"}
      </Button>
    </div>
  );
}

export function PoolManager() {
  const { pool, isLoading, mutate } = useAdminPool();
  const [showDisabled, setShowDisabled] = useState(false);

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

  const availableCount = pool.filter((k: PoolKey) => k.status === "available").length;
  const filteredPool = showDisabled
    ? pool
    : pool.filter((k: PoolKey) => k.status !== "disabled");

  return (
    <div className="space-y-4">
      <AddKeyForm onAdded={() => mutate()} />

      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {availableCount} available / {pool.length} total
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={showDisabled}
            onChange={(e) => setShowDisabled(e.target.checked)}
            className="rounded"
          />
          Show disabled
        </label>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Hint</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Assigned To</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredPool.map((key: PoolKey) => (
            <TableRow key={key.id}>
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
                {key.assignedToEmail || "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

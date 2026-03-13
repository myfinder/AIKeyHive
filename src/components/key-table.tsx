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

export function KeyTable() {
  const { keys, isLoading, mutate } = useKeys();

  async function handleDisable(id: string) {
    try {
      const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      toast.success("Key disabled");
      mutate();
    } catch {
      toast.error("Failed to disable key");
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        Loading keys...
      </div>
    );
  }

  if (keys.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        No API keys yet. Create one to get started.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Provider</TableHead>
          <TableHead>Key Hint</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Created</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {keys.map((key) => (
          <TableRow key={key.id}>
            <TableCell>
              <Badge variant="secondary" className={providerColors[key.provider]}>
                {key.provider}
              </Badge>
            </TableCell>
            <TableCell className="font-mono text-sm">
              {key.keyHint || "—"}
            </TableCell>
            <TableCell>
              <Badge
                variant={key.status === "active" ? "default" : "destructive"}
              >
                {key.status}
              </Badge>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {new Date(key.createdAt).toLocaleDateString()}
            </TableCell>
            <TableCell className="text-right">
              {key.status === "active" && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDisable(key.id)}
                >
                  Disable
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

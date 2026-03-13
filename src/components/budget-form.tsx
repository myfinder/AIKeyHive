"use client";

import { useState } from "react";
import { useAdminBudgets, useAdminUsers } from "@/hooks/use-keys";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export function BudgetManager() {
  const { budgets, isLoading, mutate } = useAdminBudgets();
  const { users } = useAdminUsers();
  const [scope, setScope] = useState("global");
  const [scopeId, setScopeId] = useState("");
  const [limit, setLimit] = useState("");
  const [threshold, setThreshold] = useState("80");

  async function handleCreate() {
    try {
      const res = await fetch("/api/admin/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope,
          scopeId: scope === "global" ? null : scopeId || null,
          monthlyLimitUsd: parseFloat(limit),
          alertThresholdPct: parseInt(threshold),
        }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Budget created");
      setLimit("");
      mutate();
    } catch {
      toast.error("Failed to create budget");
    }
  }

  async function handleDelete(id: string) {
    try {
      await fetch(`/api/admin/budgets?id=${id}`, { method: "DELETE" });
      toast.success("Budget deleted");
      mutate();
    } catch {
      toast.error("Failed to delete budget");
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        Loading budgets...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Create Budget</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label>Scope</Label>
              <Select value={scope} onValueChange={(v) => v && setScope(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">Global</SelectItem>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="team">Team</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {scope === "user" && (
              <div className="space-y-2">
                <Label>User</Label>
                <Select value={scopeId} onValueChange={(v) => v && setScopeId(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select user" />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map(
                      (u: { id: string; email: string }) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.email}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>Monthly Limit (USD)</Label>
              <Input
                type="number"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                placeholder="100.00"
              />
            </div>

            <div className="space-y-2">
              <Label>Alert Threshold (%)</Label>
              <Input
                type="number"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                min="1"
                max="100"
              />
            </div>
          </div>

          <Button onClick={handleCreate} disabled={!limit} className="mt-4">
            Create Budget
          </Button>
        </CardContent>
      </Card>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Scope</TableHead>
            <TableHead>Scope ID</TableHead>
            <TableHead className="text-right">Monthly Limit</TableHead>
            <TableHead className="text-right">Alert At</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {budgets.map(
            (b: {
              id: string;
              scope: string;
              scopeId: string | null;
              monthlyLimitUsd: number;
              alertThresholdPct: number;
            }) => (
              <TableRow key={b.id}>
                <TableCell className="capitalize">{b.scope}</TableCell>
                <TableCell className="text-sm">
                  {b.scopeId || "—"}
                </TableCell>
                <TableCell className="text-right font-mono">
                  ${b.monthlyLimitUsd.toFixed(2)}
                </TableCell>
                <TableCell className="text-right">
                  {b.alertThresholdPct}%
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDelete(b.id)}
                  >
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            )
          )}
        </TableBody>
      </Table>
    </div>
  );
}

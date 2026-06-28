"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useProxyKeys, type DashboardProxyKey } from "@/hooks/use-keys";
import { toast } from "sonner";

function formatUsd(value: number) {
  if (value > 0 && value < 0.01) {
    return `$${value.toFixed(6)}`;
  }
  return `$${value.toFixed(2)}`;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : "—";
}

async function readJsonObject(res: Response) {
  try {
    const data: unknown = await res.json();
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

function responseErrorMessage(data: object | null, fallback: string) {
  if (
    data &&
    "error" in data &&
    typeof data.error === "string" &&
    data.error
  ) {
    return data.error;
  }
  return fallback;
}

function StatusBadge({ status }: { status: DashboardProxyKey["status"] }) {
  if (status === "active") {
    return (
      <Badge variant="secondary" className="bg-green-100 text-green-800">
        active
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className="bg-muted text-muted-foreground">
      revoked
    </Badge>
  );
}

function ProxyStatusBadge({ keyData }: { keyData: DashboardProxyKey }) {
  if (keyData.status === "active" && keyData.throttle.throttled) {
    return (
      <Badge variant="secondary" className="bg-amber-100 text-amber-900">
        throttled
      </Badge>
    );
  }

  return <StatusBadge status={keyData.status} />;
}

function BudgetMeter({
  label,
  usage,
}: {
  label: string;
  usage: DashboardProxyKey["budgetUsage"]["hour"];
}) {
  const percent = Math.min(Math.max(usage.percent, 0), 100);
  const fillClass = usage.exceeded ? "bg-red-600" : "bg-green-600";

  return (
    <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5">
      <div className="text-[10px] font-semibold uppercase text-muted-foreground">
        {label}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${fillClass}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="col-start-2 font-mono text-[10px] text-muted-foreground">
        {formatUsd(usage.usedUsd)} / {formatUsd(usage.limitUsd)}
        <span className={usage.exceeded ? "text-red-700" : ""}>
          {" "}
          · {usage.percent < 1 && usage.percent > 0
            ? "<1"
            : Math.round(usage.percent)}
          %
        </span>
      </div>
    </div>
  );
}

function BudgetMeterStack({ keyData }: { keyData: DashboardProxyKey }) {
  return (
    <div className="min-w-44 space-y-1.5">
      <BudgetMeter label="Hour" usage={keyData.budgetUsage.hour} />
      <BudgetMeter label="Day" usage={keyData.budgetUsage.day} />
      <BudgetMeter label="Month" usage={keyData.budgetUsage.month} />
    </div>
  );
}

export function ProxyKeyTable() {
  const { keys, isLoading, isError, error, mutate } = useProxyKeys();
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function handleRevoke(key: DashboardProxyKey) {
    if (
      !confirm(
        "This proxy key will be revoked and will stop authorizing requests. Continue?"
      )
    )
      return;

    setRevokingId(key.id);
    try {
      const res = await fetch(`/api/proxy-keys/${key.id}`, {
        method: "DELETE",
      });
      const data = await readJsonObject(res);
      if (!res.ok) {
        throw new Error(responseErrorMessage(data, "Failed to revoke proxy key"));
      }
      toast.success("Proxy key revoked");
      mutate();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to revoke proxy key"
      );
    } finally {
      setRevokingId(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        Loading proxy keys...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-32 items-center justify-center text-destructive">
        {error || "Failed to load proxy keys"}
      </div>
    );
  }

  if (keys.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        No proxy keys yet. Create one to route requests through AIKeyHive.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Key Hint</TableHead>
          <TableHead>Allowed Models</TableHead>
          <TableHead>Hourly/Daily/Monthly Budget</TableHead>
          <TableHead>Max Request</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Last Used</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {keys.map((key) => (
          <TableRow key={key.id}>
            <TableCell className="text-sm">{key.name}</TableCell>
            <TableCell className="font-mono text-sm text-muted-foreground">
              {key.keyHint}
            </TableCell>
            <TableCell className="max-w-64 whitespace-normal text-sm text-muted-foreground">
              {key.policy.allowedModels.join(", ")}
            </TableCell>
            <TableCell className="text-sm">
              <BudgetMeterStack keyData={key} />
            </TableCell>
            <TableCell className="text-sm">
              <div className="font-mono">{formatUsd(key.policy.maxRequestUsd)}</div>
              <div className="text-xs text-muted-foreground">
                {key.policy.maxOutputTokens} tokens / {key.policy.maxConcurrency} concurrent
              </div>
            </TableCell>
            <TableCell>
              <ProxyStatusBadge keyData={key} />
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {formatDate(key.lastUsedAt)}
            </TableCell>
            <TableCell className="text-right">
              <Button
                variant="destructive"
                size="sm"
                disabled={key.status === "revoked" || revokingId === key.id}
                onClick={() => handleRevoke(key)}
              >
                {revokingId === key.id ? "Revoking..." : "Revoke"}
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

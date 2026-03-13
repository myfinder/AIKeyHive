"use client";

import { useCosts } from "@/hooks/use-keys";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface CostBreakdownProps {
  start?: string;
  end?: string;
}

export function CostBreakdown({ start, end }: CostBreakdownProps) {
  const { costs: byProvider, isLoading: loadingProvider } = useCosts({
    start,
    end,
    groupBy: "provider",
  });
  const { costs: byModel, isLoading: loadingModel } = useCosts({
    start,
    end,
    groupBy: "model",
  });

  if (loadingProvider || loadingModel) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        Loading breakdown...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 text-sm font-medium">By Provider</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead className="text-right">Total Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {byProvider.map(
              (row: { provider: string; totalCost: number }, i: number) => (
                <TableRow key={i}>
                  <TableCell>
                    <Badge variant="secondary">{row.provider}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    ${Number(row.totalCost || 0).toFixed(2)}
                  </TableCell>
                </TableRow>
              )
            )}
          </TableBody>
        </Table>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-medium">By Model</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead>Model</TableHead>
              <TableHead className="text-right">Total Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {byModel.map(
              (
                row: { provider: string; model: string; totalCost: number },
                i: number
              ) => (
                <TableRow key={i}>
                  <TableCell>
                    <Badge variant="secondary">{row.provider}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {row.model || "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    ${Number(row.totalCost || 0).toFixed(2)}
                  </TableCell>
                </TableRow>
              )
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

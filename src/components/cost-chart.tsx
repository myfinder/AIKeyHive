"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useCosts } from "@/hooks/use-keys";

interface CostChartProps {
  start?: string;
  end?: string;
}

export function CostChart({ start, end }: CostChartProps) {
  const { costs, isLoading } = useCosts({ start, end, groupBy: "date" });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Loading chart...
      </div>
    );
  }

  if (costs.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        No cost data available for this period.
      </div>
    );
  }

  const chartData = costs.map(
    (c: { date: string; totalCost: number }) => ({
      date: c.date,
      cost: Number(c.totalCost?.toFixed(2) || 0),
    })
  );

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 12 }}
          tickFormatter={(v) => v.slice(5)}
        />
        <YAxis
          tick={{ fontSize: 12 }}
          tickFormatter={(v) => `$${v}`}
        />
        <Tooltip
          formatter={(value) => [`$${Number(value).toFixed(2)}`, "Cost"]}
        />
        <Area
          type="monotone"
          dataKey="cost"
          stroke="hsl(var(--chart-1))"
          fill="hsl(var(--chart-1))"
          fillOpacity={0.2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

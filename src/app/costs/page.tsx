"use client";

import { useState } from "react";
import { Nav } from "@/components/nav";
import { CostChart } from "@/components/cost-chart";
import { CostBreakdown } from "@/components/cost-breakdown";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function CostsPage() {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [start, setStart] = useState(
    thirtyDaysAgo.toISOString().split("T")[0]
  );
  const [end, setEnd] = useState(now.toISOString().split("T")[0]);

  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <main className="mx-auto max-w-7xl space-y-6 p-6">
        <h1 className="text-2xl font-bold">Cost Analysis</h1>

        <div className="flex gap-4">
          <div className="space-y-1">
            <Label>Start Date</Label>
            <Input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>End Date</Label>
            <Input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Daily Cost Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <CostChart start={start} end={end} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cost Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <CostBreakdown start={start} end={end} />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

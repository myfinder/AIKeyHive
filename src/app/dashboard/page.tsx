"use client";

import { Nav } from "@/components/nav";
import { KeyTable } from "@/components/key-table";
import { KeyCreateDialog } from "@/components/key-create-dialog";
import { useCosts } from "@/hooks/use-keys";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function MonthlySummary() {
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const today = now.toISOString().split("T")[0];

  const { costs: byProvider } = useCosts({
    start: monthStart,
    end: today,
    groupBy: "provider",
  });

  const totalCost = byProvider.reduce(
    (sum: number, c: { totalCost: number }) => sum + (Number(c.totalCost) || 0),
    0
  );

  const providers = ["openai", "anthropic", "gemini"];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Monthly Total</CardDescription>
          <CardTitle className="text-2xl">${totalCost.toFixed(2)}</CardTitle>
        </CardHeader>
      </Card>
      {providers.map((p) => {
        const providerCost = byProvider.find(
          (c: { provider: string }) => c.provider === p
        );
        return (
          <Card key={p}>
            <CardHeader className="pb-2">
              <CardDescription className="capitalize">{p}</CardDescription>
              <CardTitle className="text-2xl">
                ${Number(providerCost?.totalCost || 0).toFixed(2)}
              </CardTitle>
            </CardHeader>
          </Card>
        );
      })}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <main className="mx-auto max-w-7xl space-y-6 p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <KeyCreateDialog />
        </div>

        <MonthlySummary />

        <Card>
          <CardHeader>
            <CardTitle>Your API Keys</CardTitle>
            <CardDescription>
              Manage your API keys across all providers
            </CardDescription>
          </CardHeader>
          <CardContent>
            <KeyTable />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

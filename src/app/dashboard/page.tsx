"use client";

import { Nav } from "@/components/nav";
import { KeyTable } from "@/components/key-table";
import { KeyCreateDialog } from "@/components/key-create-dialog";
import { ProxyKeyCreateDialog } from "@/components/proxy-key-create-dialog";
import { ProxyKeyHowToUseDialog } from "@/components/proxy-key-how-to-use-dialog";
import { ProxyKeyTable } from "@/components/proxy-key-table";
import { useCosts } from "@/hooks/use-keys";
import { useSession } from "next-auth/react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  proxyKeysBadgeLabel,
  proxyKeysDescription,
} from "@/lib/proxy/dashboard-copy";

function MonthlySummary() {
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const today = now.toISOString().split("T")[0];
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";

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
          <CardDescription>
            {isAdmin ? "Monthly Total (All Users)" : "Your Monthly Total"}
          </CardDescription>
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

function MonthlySummaryGuard() {
  const { data: session } = useSession();
  if (session?.user?.role !== "admin") return null;
  return <MonthlySummary />;
}

export default function DashboardPage() {
  return (
    <div className="flex-1 bg-background">
      <Nav />
      <main className="mx-auto max-w-7xl space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
        </div>

        <MonthlySummaryGuard />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Proxy Keys
              <Badge variant="secondary">{proxyKeysBadgeLabel}</Badge>
            </CardTitle>
            <CardDescription>{proxyKeysDescription}</CardDescription>
            <CardAction className="flex items-center gap-2">
              <ProxyKeyHowToUseDialog />
              <ProxyKeyCreateDialog />
            </CardAction>
          </CardHeader>
          <CardContent>
            <ProxyKeyTable />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Direct Keys</CardTitle>
            <CardDescription>
              Provider credentials for tools that require direct provider keys.
            </CardDescription>
            <CardAction>
              <KeyCreateDialog />
            </CardAction>
          </CardHeader>
          <CardContent>
            <KeyTable />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

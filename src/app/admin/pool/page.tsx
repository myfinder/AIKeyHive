"use client";

import { Nav } from "@/components/nav";
import { PoolManager } from "@/components/pool-manager";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function AdminPoolPage() {
  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <main className="mx-auto max-w-7xl space-y-6 p-6">
        <h1 className="text-2xl font-bold">Anthropic Key Pool</h1>

        <Card>
          <CardHeader>
            <CardTitle>Key Pool</CardTitle>
            <CardDescription>
              Manage the pool of pre-provisioned Anthropic API keys
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PoolManager />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

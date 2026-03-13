"use client";

import { Nav } from "@/components/nav";
import { BudgetManager } from "@/components/budget-form";

export default function AdminBudgetsPage() {
  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <main className="mx-auto max-w-7xl space-y-6 p-6">
        <h1 className="text-2xl font-bold">Budget Management</h1>
        <BudgetManager />
      </main>
    </div>
  );
}

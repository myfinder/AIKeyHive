import { db } from "@/db";
import { budgets, costSnapshots, apiKeys } from "@/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";

export interface BudgetCheck {
  budgetId: string;
  scope: string;
  scopeId: string | null;
  monthlyLimitUsd: number;
  currentSpendUsd: number;
  alertThresholdPct: number;
  usagePct: number;
  exceeded: boolean;
  alertTriggered: boolean;
}

export async function checkBudgets(): Promise<BudgetCheck[]> {
  const allBudgets = await db.select().from(budgets).all();
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const results: BudgetCheck[] = [];

  for (const budget of allBudgets) {
    let currentSpend = 0;

    if (budget.scope === "global") {
      const result = await db
        .select({ total: sql<number>`COALESCE(SUM(${costSnapshots.costUsd}), 0)` })
        .from(costSnapshots)
        .where(gte(costSnapshots.date, monthStart))
        .get();
      currentSpend = result?.total || 0;
    } else if (budget.scope === "user" && budget.scopeId) {
      const result = await db
        .select({ total: sql<number>`COALESCE(SUM(${costSnapshots.costUsd}), 0)` })
        .from(costSnapshots)
        .where(
          and(
            gte(costSnapshots.date, monthStart),
            eq(costSnapshots.userId, budget.scopeId)
          )
        )
        .get();
      currentSpend = result?.total || 0;
    }

    const usagePct =
      budget.monthlyLimitUsd > 0
        ? (currentSpend / budget.monthlyLimitUsd) * 100
        : 0;

    results.push({
      budgetId: budget.id,
      scope: budget.scope,
      scopeId: budget.scopeId,
      monthlyLimitUsd: budget.monthlyLimitUsd,
      currentSpendUsd: currentSpend,
      alertThresholdPct: budget.alertThresholdPct,
      usagePct,
      exceeded: usagePct >= 100,
      alertTriggered: usagePct >= budget.alertThresholdPct,
    });
  }

  return results;
}

export async function disableKeysForUser(userId: string): Promise<void> {
  await db
    .update(apiKeys)
    .set({
      status: "disabled",
      disabledAt: new Date().toISOString(),
    })
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.status, "active")));
}

export async function enforcebudgets(): Promise<BudgetCheck[]> {
  const checks = await checkBudgets();
  const exceeded = checks.filter((c) => c.exceeded);

  for (const check of exceeded) {
    if (check.scope === "user" && check.scopeId) {
      await disableKeysForUser(check.scopeId);
    }
  }

  return exceeded;
}

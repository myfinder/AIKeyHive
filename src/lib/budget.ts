import { db } from "@/db";
import { budgets, costSnapshots, apiKeys, anthropicKeyPool, users } from "@/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import * as openai from "@/lib/providers/openai";
import * as anthropicProvider from "@/lib/providers/anthropic";
import * as gemini from "@/lib/providers/gemini";

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

export async function deleteKeysForUser(userId: string): Promise<void> {
  const userKeys = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .all();

  for (const key of userKeys) {
    if (!key.providerKeyId) continue;
    try {
      if (key.provider === "openai") {
        const user = await db
          .select()
          .from(users)
          .where(eq(users.id, key.userId))
          .get();
        if (user?.openaiProjectId) {
          await openai.deleteServiceAccount(
            user.openaiProjectId,
            key.providerKeyId
          );
        }
      } else if (key.provider === "anthropic") {
        await anthropicProvider.archiveKey(key.providerKeyId);
        await db
          .update(anthropicKeyPool)
          .set({ status: "disabled", assignedTo: null, assignedAt: null })
          .where(eq(anthropicKeyPool.anthropicKeyId, key.providerKeyId));
      } else if (key.provider === "gemini") {
        const keyName = `projects/${process.env.GOOGLE_PROJECT_ID}/locations/global/keys/${key.providerKeyId}`;
        await gemini.deleteKey(keyName);
      }
    } catch (error) {
      console.error(`Provider key revocation failed for ${key.id}:`, error instanceof Error ? error.message : "Unknown error");
    }
  }

  await db.delete(apiKeys).where(eq(apiKeys.userId, userId));
}

export async function enforcebudgets(): Promise<BudgetCheck[]> {
  const checks = await checkBudgets();
  const exceeded = checks.filter((c) => c.exceeded);

  for (const check of exceeded) {
    if (check.scope === "user" && check.scopeId) {
      await deleteKeysForUser(check.scopeId);
    }
  }

  return exceeded;
}

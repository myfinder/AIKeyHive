import { NextResponse } from "next/server";
import { db } from "@/db";
import { costSnapshots, apiKeys, users } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import * as openaiCosts from "@/lib/costs/openai";
import * as anthropicCosts from "@/lib/costs/anthropic";
import * as geminiCosts from "@/lib/costs/gemini";
import { enforcebudgets } from "@/lib/budget";

export async function GET() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split("T")[0];
  const today = new Date().toISOString().split("T")[0];

  const results = { openai: 0, anthropic: 0, gemini: 0, budgetExceeded: 0 };

  try {
    // OpenAI costs
    if (process.env.OPENAI_ADMIN_KEY) {
      const entries = await openaiCosts.fetchCosts(dateStr, today);
      for (const entry of entries) {
        // Map project to user
        let userId: string | null = null;
        if (entry.projectId) {
          const key = await db
            .select()
            .from(apiKeys)
            .where(
              and(
                eq(apiKeys.provider, "openai"),
                eq(apiKeys.providerProjectId, entry.projectId)
              )
            )
            .get();
          userId = key?.userId || null;
        }

        await db.insert(costSnapshots).values({
          provider: "openai",
          date: entry.date,
          userId,
          model: entry.model,
          costUsd: entry.costUsd,
          rawData: JSON.stringify(entry),
        });
        results.openai++;
      }
    }

    // Anthropic costs
    if (process.env.ANTHROPIC_ADMIN_KEY) {
      const entries = await anthropicCosts.fetchCosts(dateStr, today);
      for (const entry of entries) {
        await db.insert(costSnapshots).values({
          provider: "anthropic",
          date: entry.date,
          model: entry.model,
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
          costUsd: entry.costUsd,
          rawData: JSON.stringify(entry),
        });
        results.anthropic++;
      }
    }

    // Gemini costs
    if (process.env.BIGQUERY_BILLING_TABLE) {
      const entries = await geminiCosts.fetchCosts(dateStr, today);
      for (const entry of entries) {
        await db.insert(costSnapshots).values({
          provider: "gemini",
          date: entry.date,
          model: entry.model,
          costUsd: entry.costUsd,
          rawData: JSON.stringify(entry),
        });
        results.gemini++;
      }
    }

    // Check budgets
    const exceeded = await enforcebudgets();
    results.budgetExceeded = exceeded.length;

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("Cost sync failed:", error);
    return NextResponse.json(
      { error: "Cost sync failed" },
      { status: 500 }
    );
  }
}

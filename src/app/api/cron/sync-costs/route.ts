import { NextResponse } from "next/server";
import { db } from "@/db";
import { costSnapshots, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import * as openaiCosts from "@/lib/costs/openai";
import * as anthropicCosts from "@/lib/costs/anthropic";
import * as geminiCosts from "@/lib/costs/gemini";
import { enforcebudgets } from "@/lib/budget";

export async function GET() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split("T")[0];
  const today = new Date().toISOString().split("T")[0];

  const results: Record<string, unknown> = {
    openai: 0,
    anthropic: 0,
    gemini: 0,
    budgetExceeded: 0,
    errors: [] as string[],
  };

  // OpenAI costs
  if (process.env.OPENAI_ADMIN_KEY) {
    try {
      const entries = await openaiCosts.fetchCosts(dateStr, today);
      for (const entry of entries) {
        let userId: string | null = null;
        if (entry.projectId) {
          const user = await db
            .select()
            .from(users)
            .where(eq(users.openaiProjectId, entry.projectId))
            .get();
          userId = user?.id || null;
        }

        await db.insert(costSnapshots).values({
          provider: "openai",
          date: entry.date,
          userId,
          model: entry.model,
          costUsd: entry.costUsd,
          rawData: JSON.stringify(entry),
        });
        (results.openai as number)++;
      }
    } catch (error) {
      console.error("OpenAI cost sync failed:", error);
      (results.errors as string[]).push(`openai: ${error}`);
    }
  }

  // Anthropic costs
  if (process.env.ANTHROPIC_ADMIN_KEY) {
    try {
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
        (results.anthropic as number)++;
      }
    } catch (error) {
      console.error("Anthropic cost sync failed:", error);
      (results.errors as string[]).push(`anthropic: ${error}`);
    }
  }

  // Gemini costs
  if (process.env.BIGQUERY_BILLING_TABLE) {
    try {
      const entries = await geminiCosts.fetchCosts(dateStr, today);
      for (const entry of entries) {
        await db.insert(costSnapshots).values({
          provider: "gemini",
          date: entry.date,
          model: entry.model,
          costUsd: entry.costUsd,
          rawData: JSON.stringify(entry),
        });
        (results.gemini as number)++;
      }
    } catch (error) {
      console.error("Gemini cost sync failed:", error);
      (results.errors as string[]).push(`gemini: ${error}`);
    }
  }

  // Check budgets
  try {
    const exceeded = await enforcebudgets();
    results.budgetExceeded = exceeded.length;
  } catch (error) {
    console.error("Budget check failed:", error);
    (results.errors as string[]).push(`budget: ${error}`);
  }

  return NextResponse.json({ success: true, results });
}

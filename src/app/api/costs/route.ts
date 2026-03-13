import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { costSnapshots } from "@/db/schema";
import { and, gte, lte, eq, sql } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const startDate = searchParams.get("start");
  const endDate = searchParams.get("end");
  const groupBy = searchParams.get("groupBy") || "date"; // date, provider, model

  const conditions = [];
  if (startDate) conditions.push(gte(costSnapshots.date, startDate));
  if (endDate) conditions.push(lte(costSnapshots.date, endDate));

  // Non-admin users can only see their own costs
  if (session.user.role !== "admin") {
    conditions.push(eq(costSnapshots.userId, session.user.id));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  if (groupBy === "provider") {
    const data = await db
      .select({
        provider: costSnapshots.provider,
        totalCost: sql<number>`SUM(${costSnapshots.costUsd})`,
        totalInput: sql<number>`SUM(${costSnapshots.inputTokens})`,
        totalOutput: sql<number>`SUM(${costSnapshots.outputTokens})`,
      })
      .from(costSnapshots)
      .where(where)
      .groupBy(costSnapshots.provider)
      .all();
    return NextResponse.json({ data });
  }

  if (groupBy === "model") {
    const data = await db
      .select({
        provider: costSnapshots.provider,
        model: costSnapshots.model,
        totalCost: sql<number>`SUM(${costSnapshots.costUsd})`,
      })
      .from(costSnapshots)
      .where(where)
      .groupBy(costSnapshots.provider, costSnapshots.model)
      .all();
    return NextResponse.json({ data });
  }

  // Default: group by date
  const data = await db
    .select({
      date: costSnapshots.date,
      totalCost: sql<number>`SUM(${costSnapshots.costUsd})`,
    })
    .from(costSnapshots)
    .where(where)
    .groupBy(costSnapshots.date)
    .orderBy(costSnapshots.date)
    .all();

  return NextResponse.json({ data });
}

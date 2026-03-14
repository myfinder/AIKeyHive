import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { budgets } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const all = await db.select().from(budgets).all();
  return NextResponse.json({ data: all });
}

const budgetSchema = z.object({
  scope: z.enum(["user", "team", "global"]),
  scopeId: z.string().nullable().optional(),
  monthlyLimitUsd: z.number().positive(),
  alertThresholdPct: z.number().min(1).max(100).default(80),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = budgetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const newBudget = await db
    .insert(budgets)
    .values({
      scope: parsed.data.scope,
      scopeId: parsed.data.scopeId || null,
      monthlyLimitUsd: parsed.data.monthlyLimitUsd,
      alertThresholdPct: parsed.data.alertThresholdPct,
    })
    .returning()
    .get();

  return NextResponse.json({ data: newBudget });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  await db.delete(budgets).where(eq(budgets.id, id));
  return NextResponse.json({ success: true });
}

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { modelPrices } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select({
      provider: modelPrices.provider,
      model: modelPrices.model,
      inputUsdPer1m: modelPrices.inputUsdPer1m,
      cachedInputUsdPer1m: modelPrices.cachedInputUsdPer1m,
      outputUsdPer1m: modelPrices.outputUsdPer1m,
    })
    .from(modelPrices)
    .where(and(eq(modelPrices.provider, "openai"), eq(modelPrices.active, 1)))
    .orderBy(modelPrices.model)
    .all();

  return NextResponse.json({ data: rows });
}

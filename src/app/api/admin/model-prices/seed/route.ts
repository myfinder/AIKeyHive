import { NextResponse } from "next/server";
import { auth } from "@/auth";
import type { ModelPrice } from "@/db/schema";
import { seedDefaultModelPrices } from "@/lib/proxy/seed-prices";

function serializeModelPrice(row: ModelPrice) {
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    inputUsdPer1m: row.inputUsdPer1m,
    cachedInputUsdPer1m: row.cachedInputUsdPer1m,
    outputUsdPer1m: row.outputUsdPer1m,
    active: row.active === 1,
    createdAt: row.createdAt,
  };
}

export async function POST() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const inserted = await seedDefaultModelPrices();
  return NextResponse.json({ data: inserted.map(serializeModelPrice) });
}

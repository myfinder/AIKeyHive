import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { modelPrices } from "@/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";

const modelPriceSchema = z.object({
  provider: z.enum(["openai", "anthropic", "gemini"]),
  model: z.string().trim().min(1),
  inputUsdPer1m: z.number().positive(),
  cachedInputUsdPer1m: z.number().positive().nullable().optional(),
  outputUsdPer1m: z.number().positive(),
  active: z.boolean(),
});

const modelPricePatchSchema = z.object({
  id: z.string().trim().min(1),
  active: z.boolean(),
});

type ModelPriceRow = typeof modelPrices.$inferSelect;

export function serializeModelPrice(row: ModelPriceRow) {
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

function activeDuplicateResponse() {
  return NextResponse.json(
    { error: "An active price already exists for this provider and model" },
    { status: 409 }
  );
}

function isActiveDuplicateError(error: unknown) {
  return (
    error instanceof Error &&
    (error.message.includes("model_prices_active_provider_model_unique") ||
      error.message.includes(
        "UNIQUE constraint failed: model_prices.provider, model_prices.model"
      ))
  );
}

export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await db
    .select()
    .from(modelPrices)
    .orderBy(modelPrices.provider, modelPrices.model, modelPrices.createdAt, modelPrices.id)
    .all();

  return NextResponse.json({ data: rows.map(serializeModelPrice) });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON" }, { status: 400 });
  }

  const parsed = modelPriceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  if (parsed.data.active) {
    const existingActive = await db
      .select({ id: modelPrices.id })
      .from(modelPrices)
      .where(
        and(
          eq(modelPrices.provider, parsed.data.provider),
          eq(modelPrices.model, parsed.data.model),
          eq(modelPrices.active, 1)
        )
      )
      .get();

    if (existingActive) {
      return activeDuplicateResponse();
    }
  }

  try {
    const row = await db
      .insert(modelPrices)
      .values({
        provider: parsed.data.provider,
        model: parsed.data.model,
        inputUsdPer1m: parsed.data.inputUsdPer1m,
        cachedInputUsdPer1m: parsed.data.cachedInputUsdPer1m ?? null,
        outputUsdPer1m: parsed.data.outputUsdPer1m,
        active: parsed.data.active ? 1 : 0,
      })
      .returning()
      .get();

    return NextResponse.json({ data: serializeModelPrice(row) });
  } catch (error) {
    if (isActiveDuplicateError(error)) {
      return activeDuplicateResponse();
    }
    throw error;
  }
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON" }, { status: 400 });
  }

  const parsed = modelPricePatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const existing = await db
    .select()
    .from(modelPrices)
    .where(eq(modelPrices.id, parsed.data.id))
    .get();

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (parsed.data.active) {
    const existingActive = await db
      .select({ id: modelPrices.id })
      .from(modelPrices)
      .where(
        and(
          eq(modelPrices.provider, existing.provider),
          eq(modelPrices.model, existing.model),
          eq(modelPrices.active, 1),
          ne(modelPrices.id, existing.id)
        )
      )
      .get();

    if (existingActive) {
      return activeDuplicateResponse();
    }
  }

  try {
    const row = await db
      .update(modelPrices)
      .set({ active: parsed.data.active ? 1 : 0 })
      .where(eq(modelPrices.id, parsed.data.id))
      .returning()
      .get();

    return NextResponse.json({ data: serializeModelPrice(row) });
  } catch (error) {
    if (isActiveDuplicateError(error)) {
      return activeDuplicateResponse();
    }
    throw error;
  }
}

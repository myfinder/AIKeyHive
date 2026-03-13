import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { anthropicKeyPool } from "@/db/schema";
import { z } from "zod";

export async function GET() {
  const pool = await db.select().from(anthropicKeyPool).all();
  return NextResponse.json({ data: pool });
}

const addKeySchema = z.object({
  anthropicKeyId: z.string().min(1),
  keyHint: z.string().optional(),
  workspaceId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = addKeySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const newKey = await db
    .insert(anthropicKeyPool)
    .values({
      anthropicKeyId: parsed.data.anthropicKeyId,
      keyHint: parsed.data.keyHint || null,
      workspaceId: parsed.data.workspaceId || null,
    })
    .returning()
    .get();

  return NextResponse.json({ data: newKey });
}

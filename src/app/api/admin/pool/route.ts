import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { anthropicKeyPool, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { findKeyByHint } from "@/lib/providers/anthropic";

export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const pool = await db
    .select({
      id: anthropicKeyPool.id,
      keyHint: anthropicKeyPool.keyHint,
      status: anthropicKeyPool.status,
      assignedTo: anthropicKeyPool.assignedTo,
      assignedToEmail: users.email,
      assignedAt: anthropicKeyPool.assignedAt,
    })
    .from(anthropicKeyPool)
    .leftJoin(users, eq(anthropicKeyPool.assignedTo, users.id))
    .all();
  return NextResponse.json({ data: pool });
}

const addKeySchema = z.object({
  keyValue: z.string().min(1, "API key is required").startsWith("sk-ant-", "Key must start with sk-ant-"),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = addKeySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const keyValue = parsed.data.keyValue;

  // Check for duplicates
  const existing = await db
    .select()
    .from(anthropicKeyPool)
    .where(eq(anthropicKeyPool.keyValue, keyValue))
    .get();

  if (existing) {
    return NextResponse.json({ error: "This key already exists in the pool" }, { status: 409 });
  }

  // Look up the Anthropic key ID via Admin API using the last 4 chars
  const last4 = keyValue.slice(-4);
  const matched = await findKeyByHint(
    last4,
    process.env.ANTHROPIC_WORKSPACE_ID
  );

  if (!matched) {
    return NextResponse.json(
      { error: "Could not find this key on Anthropic. Verify it belongs to the AIKeyHive workspace." },
      { status: 404 }
    );
  }

  const hint = matched.partial_key_hint;

  await db
    .insert(anthropicKeyPool)
    .values({
      anthropicKeyId: matched.id,
      keyHint: hint,
      keyValue,
    });

  return NextResponse.json({ success: true, keyHint: hint });
}

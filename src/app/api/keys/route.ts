import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { apiKeys, anthropicKeyPool } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import * as openai from "@/lib/providers/openai";
import * as gemini from "@/lib/providers/gemini";

const createKeySchema = z.object({
  provider: z.enum(["openai", "anthropic", "gemini"]),
  name: z.string().min(1).max(100),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keys = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.userId, session.user.id))
    .all();

  return NextResponse.json({ data: keys });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = createKeySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { provider, name } = parsed.data;
  let fullKey: string | null = null;
  let providerKeyId: string | null = null;
  let providerProjectId: string | null = null;
  let keyHint: string | null = null;

  try {
    if (provider === "openai") {
      const project = await openai.createProject(
        `aikeyhive-${session.user.email}-${name}`
      );
      const sa = await openai.createServiceAccountKey(project.id, name);
      fullKey = sa.api_key.value;
      providerKeyId = sa.api_key.id;
      providerProjectId = project.id;
      keyHint = `sk-...${fullKey.slice(-4)}`;
    } else if (provider === "anthropic") {
      // Assign from pool
      const available = await db
        .select()
        .from(anthropicKeyPool)
        .where(eq(anthropicKeyPool.status, "available"))
        .limit(1)
        .all();

      if (available.length === 0) {
        return NextResponse.json(
          { error: "No Anthropic keys available in pool" },
          { status: 409 }
        );
      }

      const poolKey = available[0];
      await db
        .update(anthropicKeyPool)
        .set({
          status: "assigned",
          assignedTo: session.user.id,
          assignedAt: new Date().toISOString(),
        })
        .where(eq(anthropicKeyPool.id, poolKey.id));

      providerKeyId = poolKey.anthropicKeyId;
      keyHint = poolKey.keyHint;
    } else if (provider === "gemini") {
      const result = await gemini.createKey(
        `aikeyhive-${session.user.email}-${name}`
      );
      fullKey = result.keyString;
      providerKeyId = gemini.extractKeyId(result.key.name);
      keyHint = `AIza...${fullKey.slice(-4)}`;
    }

    const newKey = await db
      .insert(apiKeys)
      .values({
        userId: session.user.id,
        provider,
        providerKeyId,
        providerProjectId,
        keyHint,
      })
      .returning()
      .get();

    return NextResponse.json({
      data: newKey,
      ...(fullKey ? { key: fullKey } : {}),
    });
  } catch (error) {
    console.error("Key creation failed:", error);
    return NextResponse.json(
      { error: "Failed to create key" },
      { status: 500 }
    );
  }
}

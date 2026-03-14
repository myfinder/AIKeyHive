import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { apiKeys, anthropicKeyPool, users } from "@/db/schema";
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
    .select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      provider: apiKeys.provider,
      name: apiKeys.name,
      keyHint: apiKeys.keyHint,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, session.user.id))
    .all();

  return NextResponse.json({ data: keys });
}

async function getOrCreateOpenAIProject(
  userId: string,
  email: string
): Promise<string> {
  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .get();

  if (user?.openaiProjectId) {
    return user.openaiProjectId;
  }

  const project = await openai.createProject(`aikeyhive-${email}`);
  await db
    .update(users)
    .set({ openaiProjectId: project.id })
    .where(eq(users.id, userId));

  return project.id;
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

  // Check for duplicate: same user + provider + name
  const existing = await db
    .select()
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.userId, session.user.id),
        eq(apiKeys.provider, provider),
        eq(apiKeys.name, name)
      )
    )
    .all();

  if (existing.length > 0) {
    return NextResponse.json(
      { error: `An active ${provider} key with name "${name}" already exists` },
      { status: 409 }
    );
  }

  let fullKey: string | null = null;
  let providerKeyId: string | null = null;
  let keyHint: string | null = null;

  try {
    if (provider === "openai") {
      const projectId = await getOrCreateOpenAIProject(
        session.user.id,
        session.user.email!
      );
      const sa = await openai.createServiceAccountKey(projectId, name);
      fullKey = sa.api_key.value;
      providerKeyId = sa.id;
      keyHint = `sk-...${fullKey.slice(-4)}`;
    } else if (provider === "anthropic") {
      const available = await db
        .select()
        .from(anthropicKeyPool)
        .where(eq(anthropicKeyPool.status, "available"))
        .limit(1)
        .all();

      if (available.length === 0) {
        return NextResponse.json(
          { error: "Anthropic keys are currently unavailable. Please contact your administrator." },
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
      fullKey = poolKey.keyValue;
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
        name,
        providerKeyId,
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

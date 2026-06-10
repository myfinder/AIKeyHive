import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { apiKeys, anthropicKeyPool, users } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import * as openai from "@/lib/providers/openai";
import * as anthropic from "@/lib/providers/anthropic";
import * as gemini from "@/lib/providers/gemini";
import { decrypt } from "@/lib/crypto";

const createKeySchema = z.object({
  provider: z.enum(["openai", "anthropic", "gemini"]),
  name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/, "Name may only contain letters, numbers, hyphens, and underscores"),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keys = await db
    .select({
      id: apiKeys.id,
      provider: apiKeys.provider,
      name: apiKeys.name,
      keyHint: apiKeys.keyHint,
      createdAt: apiKeys.createdAt,
      providerKeyId: apiKeys.providerKeyId,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, session.user.id))
    .all();

  // Live last-used lookup; failures degrade to null without breaking the list
  const [openaiLastUsed, anthropicLastUsed] = await Promise.all([
    fetchOpenAILastUsed(session.user.id, keys),
    fetchAnthropicLastUsed(keys),
  ]);

  return NextResponse.json({
    data: keys.map(({ providerKeyId, ...key }) => ({
      ...key,
      lastUsedAt:
        (providerKeyId &&
          (key.provider === "openai"
            ? openaiLastUsed.get(providerKeyId)
            : key.provider === "anthropic"
              ? anthropicLastUsed.get(providerKeyId)
              : null)) ||
        null,
    })),
  });
}

type KeyRow = { provider: string; providerKeyId: string | null };

// OpenAI: providerKeyId is the service-account id; the key list carries last_used_at
async function fetchOpenAILastUsed(
  userId: string,
  keys: KeyRow[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!keys.some((k) => k.provider === "openai")) return map;
  try {
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .get();
    if (!user?.openaiProjectId) return map;
    const { data } = await openai.listProjectApiKeys(user.openaiProjectId);
    for (const key of data) {
      const saId = key.owner?.service_account?.id;
      if (saId && key.last_used_at) {
        map.set(saId, new Date(key.last_used_at * 1000).toISOString());
      }
    }
  } catch (error) {
    console.error("OpenAI last-used lookup failed:", error);
  }
  return map;
}

async function fetchAnthropicLastUsed(
  keys: KeyRow[]
): Promise<Map<string, string>> {
  if (!keys.some((k) => k.provider === "anthropic")) return new Map();
  try {
    return await anthropic.fetchLastUsedByApiKey();
  } catch (error) {
    console.error("Anthropic last-used lookup failed:", error);
    return new Map();
  }
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
      { error: "Invalid input" },
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
      // Atomic update: claim first available key in a single UPDATE with WHERE status='available'
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

      const candidate = available[0];
      // Use conditional update to prevent race condition
      const updated = await db
        .update(anthropicKeyPool)
        .set({
          status: "assigned",
          assignedTo: session.user.id,
          assignedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(anthropicKeyPool.id, candidate.id),
            eq(anthropicKeyPool.status, "available")
          )
        )
        .returning()
        .all();

      const poolKey = updated.length > 0 ? candidate : null;

      if (!poolKey) {
        return NextResponse.json(
          { error: "Anthropic keys are currently unavailable. Please contact your administrator." },
          { status: 409 }
        );
      }

      providerKeyId = poolKey.anthropicKeyId;
      fullKey = poolKey.keyValue ? decrypt(poolKey.keyValue) : null;
      keyHint = poolKey.keyHint;

      // Clear plaintext key value from pool after assignment
      await db
        .update(anthropicKeyPool)
        .set({ keyValue: null })
        .where(eq(anthropicKeyPool.id, candidate.id));
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

    const res = NextResponse.json({
      data: {
        id: newKey.id,
        provider: newKey.provider,
        name: newKey.name,
        keyHint: newKey.keyHint,
        createdAt: newKey.createdAt,
      },
      ...(fullKey ? { key: fullKey } : {}),
    });
    if (fullKey) {
      res.headers.set("Cache-Control", "no-store, no-cache");
      res.headers.set("Pragma", "no-cache");
    }
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Key creation failed:", message, error instanceof Error ? error.stack : "");
    return NextResponse.json(
      { error: "Failed to create key. Please try again or contact your administrator." },
      { status: 500 }
    );
  }
}

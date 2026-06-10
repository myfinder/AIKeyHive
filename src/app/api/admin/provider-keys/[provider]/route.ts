import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { apiKeys, anthropicKeyPool, users } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import * as openai from "@/lib/providers/openai";
import * as anthropic from "@/lib/providers/anthropic";
import * as gemini from "@/lib/providers/gemini";
import {
  reconcileOpenAIKeys,
  reconcileAnthropicKeys,
  reconcileGeminiKeys,
  type ProviderKeyEntry,
} from "@/lib/provider-keys";

const providerSchema = z.enum(["openai", "anthropic", "gemini"]);

async function managedKeyRows(provider: "openai" | "gemini") {
  return db
    .select({
      providerKeyId: apiKeys.providerKeyId,
      keyName: apiKeys.name,
      ownerEmail: users.email,
    })
    .from(apiKeys)
    .leftJoin(users, eq(apiKeys.userId, users.id))
    .where(eq(apiKeys.provider, provider))
    .all();
}

async function listOpenAI(): Promise<ProviderKeyEntry[]> {
  const projects = await openai.listProjects();
  const keysByProject: Record<string, openai.OpenAIProjectApiKey[]> = {};
  // Fan out in chunks of 5 to stay under admin API rate limits
  for (let i = 0; i < projects.length; i += 5) {
    const chunk = projects.slice(i, i + 5);
    const results = await Promise.all(
      chunk.map((p) => openai.listProjectApiKeys(p.id))
    );
    chunk.forEach((p, idx) => {
      keysByProject[p.id] = results[idx].data;
    });
  }
  return reconcileOpenAIKeys(
    projects,
    keysByProject,
    await managedKeyRows("openai")
  );
}

async function listAnthropic(): Promise<ProviderKeyEntry[]> {
  const { data: orgKeys } = await anthropic.listOrgKeys();
  const pool = await db
    .select({
      anthropicKeyId: anthropicKeyPool.anthropicKeyId,
      assignedToEmail: users.email,
    })
    .from(anthropicKeyPool)
    .leftJoin(users, eq(anthropicKeyPool.assignedTo, users.id))
    .all();
  return reconcileAnthropicKeys(orgKeys, pool);
}

async function listGemini(): Promise<ProviderKeyEntry[]> {
  const gcpKeys = await gemini.listKeys();
  return reconcileGeminiKeys(
    gcpKeys,
    await managedKeyRows("gemini"),
    process.env.GOOGLE_PROJECT_ID || ""
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = providerSchema.safeParse((await params).provider);
  if (!parsed.success) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }
  const provider = parsed.data;

  try {
    const entries =
      provider === "openai"
        ? await listOpenAI()
        : provider === "anthropic"
          ? await listAnthropic()
          : await listGemini();
    return NextResponse.json({ data: entries });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Provider key listing failed (${provider}):`, message);
    return NextResponse.json(
      { error: `Failed to fetch keys from ${provider}. Check that admin credentials are configured.` },
      { status: 502 }
    );
  }
}

const deleteSchema = z.object({
  keyId: z.string().min(1),
  projectId: z.string().optional(),
  ownerType: z.enum(["user", "service_account"]).optional(),
  serviceAccountId: z.string().optional(),
});

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsedProvider = providerSchema.safeParse((await params).provider);
  if (!parsedProvider.success) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }
  const provider = parsedProvider.data;

  const parsed = deleteSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { keyId, projectId, ownerType, serviceAccountId } = parsed.data;

  // Refuse to touch managed keys — those are deleted via the dashboard flow
  // so the DB record is cleaned up together with the provider key.
  const managedId =
    provider === "openai" ? serviceAccountId || keyId : keyId;
  const managed = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(
      and(eq(apiKeys.provider, provider), eq(apiKeys.providerKeyId, managedId))
    )
    .get();
  if (managed) {
    return NextResponse.json(
      { error: "This key is managed by AIKeyHive. Delete it from the owner's dashboard instead." },
      { status: 409 }
    );
  }
  if (provider === "anthropic") {
    const inPool = await db
      .select({ id: anthropicKeyPool.id })
      .from(anthropicKeyPool)
      .where(eq(anthropicKeyPool.anthropicKeyId, keyId))
      .get();
    if (inPool) {
      return NextResponse.json(
        { error: "This key is in the Anthropic pool. Manage it from the Key Pool page instead." },
        { status: 409 }
      );
    }
  }

  try {
    if (provider === "openai") {
      if (!projectId) {
        return NextResponse.json(
          { error: "projectId is required for OpenAI keys" },
          { status: 400 }
        );
      }
      if (ownerType === "service_account" && serviceAccountId) {
        await openai.deleteServiceAccount(projectId, serviceAccountId);
      } else {
        await openai.deleteProjectApiKey(projectId, keyId);
      }
    } else if (provider === "anthropic") {
      await anthropic.archiveKey(keyId);
    } else {
      await gemini.deleteKey(
        `projects/${process.env.GOOGLE_PROJECT_ID}/locations/global/keys/${keyId}`
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Provider key deletion failed (${provider}):`, message);
    return NextResponse.json(
      { error: "Failed to delete key on the provider" },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true });
}

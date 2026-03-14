import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { apiKeys, anthropicKeyPool, users } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import * as openai from "@/lib/providers/openai";
import * as anthropicProvider from "@/lib/providers/anthropic";
import * as gemini from "@/lib/providers/gemini";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const key = await db
    .select()
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.id, id),
        session.user.role === "admin"
          ? undefined
          : eq(apiKeys.userId, session.user.id)
      )
    )
    .get();

  if (!key) {
    return NextResponse.json({ error: "Key not found" }, { status: 404 });
  }

  try {
    if (key.provider === "openai" && key.providerKeyId) {
      // Get the user's OpenAI project ID
      const user = await db
        .select()
        .from(users)
        .where(eq(users.id, key.userId))
        .get();
      if (user?.openaiProjectId) {
        await openai.deleteServiceAccount(
          user.openaiProjectId,
          key.providerKeyId
        );
      }
    } else if (key.provider === "anthropic" && key.providerKeyId) {
      // Set key to inactive on Anthropic
      await anthropicProvider.archiveKey(key.providerKeyId);
      // Update pool status
      await db
        .update(anthropicKeyPool)
        .set({ status: "disabled", assignedTo: null, assignedAt: null })
        .where(eq(anthropicKeyPool.anthropicKeyId, key.providerKeyId));
    } else if (key.provider === "gemini" && key.providerKeyId) {
      const keyName = `projects/${process.env.GOOGLE_PROJECT_ID}/locations/global/keys/${key.providerKeyId}`;
      await gemini.deleteKey(keyName);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Provider key deletion failed:", message);
    return NextResponse.json(
      { error: "Failed to delete key from provider", detail: message },
      { status: 502 }
    );
  }

  await db.delete(apiKeys).where(eq(apiKeys.id, id));

  return NextResponse.json({ success: true });
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { apiKeys, anthropicKeyPool } from "@/db/schema";
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
        // Admins can disable any key, users only their own
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
    if (key.provider === "openai" && key.providerProjectId && key.providerKeyId) {
      await openai.deleteProjectApiKey(key.providerProjectId, key.providerKeyId);
    } else if (key.provider === "anthropic" && key.providerKeyId) {
      await anthropicProvider.disableKey(key.providerKeyId);
      // Return key to pool as disabled
      await db
        .update(anthropicKeyPool)
        .set({ status: "disabled", assignedTo: null, assignedAt: null })
        .where(eq(anthropicKeyPool.anthropicKeyId, key.providerKeyId));
    } else if (key.provider === "gemini" && key.providerKeyId) {
      const keyName = `projects/${process.env.GOOGLE_PROJECT_ID}/locations/global/keys/${key.providerKeyId}`;
      await gemini.deleteKey(keyName);
    }
  } catch (error) {
    console.error("Provider key disable failed:", error);
  }

  await db
    .update(apiKeys)
    .set({ status: "disabled", disabledAt: new Date().toISOString() })
    .where(eq(apiKeys.id, id));

  return NextResponse.json({ success: true });
}

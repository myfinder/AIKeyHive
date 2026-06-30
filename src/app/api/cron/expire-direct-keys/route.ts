import { NextResponse } from "next/server";
import { db } from "@/db";
import { apiKeys, anthropicKeyPool, users, type ApiKey } from "@/db/schema";
import { and, eq, isNotNull, lte, or } from "drizzle-orm";
import { verifyCronSecret } from "@/lib/crypto";
import * as openai from "@/lib/providers/openai";
import * as anthropic from "@/lib/providers/anthropic";
import * as gemini from "@/lib/providers/gemini";

type ExpiringKey = Pick<
  ApiKey,
  "id" | "userId" | "provider" | "providerKeyId"
>;

export async function GET(req: Request) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date().toISOString();
  const keys = await db
    .select()
    .from(apiKeys)
    .where(
      and(
        isNotNull(apiKeys.expiresAt),
        lte(apiKeys.expiresAt, now),
        or(
          eq(apiKeys.status, "active"),
          eq(apiKeys.status, "revocation_failed")
        )
      )
    )
    .all();

  const results = {
    scanned: keys.length,
    expired: 0,
    failed: 0,
  };

  for (const key of keys) {
    try {
      await revokeProviderKey(key);
      await db
        .update(apiKeys)
        .set({
          status: "expired",
          revokedAt: new Date().toISOString(),
          revocationError: null,
        })
        .where(eq(apiKeys.id, key.id));
      results.expired++;
    } catch (error) {
      console.error(
        `Direct key expiration failed for ${key.provider}/${key.id}:`,
        error instanceof Error ? error.message : String(error)
      );
      await db
        .update(apiKeys)
        .set({
          status: "revocation_failed",
          revocationError: `${key.provider} revocation failed`,
        })
        .where(eq(apiKeys.id, key.id));
      results.failed++;
    }
  }

  return NextResponse.json({ success: true, results });
}

async function revokeProviderKey(key: ExpiringKey) {
  if (!key.providerKeyId) {
    throw new Error("provider key id is missing");
  }

  if (key.provider === "openai") {
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, key.userId))
      .get();
    if (!user?.openaiProjectId) {
      throw new Error("OpenAI project id is missing");
    }
    await openai.deleteServiceAccount(user.openaiProjectId, key.providerKeyId);
    return;
  }

  if (key.provider === "anthropic") {
    await anthropic.archiveKey(key.providerKeyId);
    await db
      .update(anthropicKeyPool)
      .set({ status: "disabled", assignedTo: null, assignedAt: null })
      .where(eq(anthropicKeyPool.anthropicKeyId, key.providerKeyId));
    return;
  }

  if (key.provider === "gemini") {
    if (!process.env.GOOGLE_PROJECT_ID) {
      throw new Error("Google project id is missing");
    }
    const keyName = `projects/${process.env.GOOGLE_PROJECT_ID}/locations/global/keys/${key.providerKeyId}`;
    await gemini.deleteKey(keyName);
  }
}

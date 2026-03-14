import { NextResponse } from "next/server";
import { db } from "@/db";
import { anthropicKeyPool } from "@/db/schema";
import { eq } from "drizzle-orm";
import { syncPoolFromAdmin } from "@/lib/providers/anthropic";

export async function GET(req: Request) {
  // Defense-in-depth: verify cron secret even if middleware already checked
  const { verifyCronSecret } = await import("@/lib/crypto");
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    if (!process.env.ANTHROPIC_ADMIN_KEY) {
      return NextResponse.json({ skipped: true, reason: "No admin key" });
    }

    const activeKeys = await syncPoolFromAdmin();
    let added = 0;

    for (const key of activeKeys) {
      const existing = await db
        .select()
        .from(anthropicKeyPool)
        .where(eq(anthropicKeyPool.anthropicKeyId, key.id))
        .get();

      if (!existing) {
        await db.insert(anthropicKeyPool).values({
          anthropicKeyId: key.id,
          keyHint: key.partial_key_hint,
          workspaceId: key.workspace_id,
          status: "available",
        });
        added++;
      }
    }

    return NextResponse.json({ success: true, synced: activeKeys.length, added });
  } catch (error) {
    console.error("Anthropic pool sync failed:", error);
    return NextResponse.json(
      { error: "Pool sync failed" },
      { status: 500 }
    );
  }
}

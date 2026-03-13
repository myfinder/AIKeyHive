import { NextResponse } from "next/server";
import { db } from "@/db";
import { anthropicKeyPool } from "@/db/schema";
import { eq } from "drizzle-orm";
import { syncPoolFromAdmin } from "@/lib/providers/anthropic";

export async function GET() {
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
          keyHint: key.hint,
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

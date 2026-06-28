import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { proxyKeys } from "@/db/schema";
import * as openai from "@/lib/providers/openai";
import { and, eq } from "drizzle-orm";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const key = session.user.role === "admin"
    ? await db.select().from(proxyKeys).where(eq(proxyKeys.id, id)).get()
    : await db
        .select()
        .from(proxyKeys)
        .where(and(eq(proxyKeys.id, id), eq(proxyKeys.userId, session.user.id)))
        .get();

  if (!key) {
    return NextResponse.json({ error: "Key not found" }, { status: 404 });
  }

  if (key.status === "revoked") {
    return NextResponse.json({ success: true });
  }

  await db
    .update(proxyKeys)
    .set({
      status: "revoked",
      revokedAt: new Date().toISOString(),
    })
    .where(eq(proxyKeys.id, id))
    .run();

  if (key.upstreamProjectId && key.upstreamProviderKeyId) {
    try {
      await openai.deleteServiceAccount(
        key.upstreamProjectId,
        key.upstreamProviderKeyId
      );
    } catch (error) {
      console.error("Failed to delete proxy upstream service account", error);
    }
  }

  return NextResponse.json({ success: true });
}

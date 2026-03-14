import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const updateUserSchema = z.object({
  role: z.enum(["user", "admin"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  // Prevent last admin from being demoted
  if (parsed.data.role === "user") {
    const adminCount = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "admin"))
      .all();
    if (adminCount.length <= 1 && adminCount.some((a) => a.id === id)) {
      return NextResponse.json(
        { error: "Cannot demote the last admin" },
        { status: 400 }
      );
    }
  }

  const updated = await db
    .update(users)
    .set({ role: parsed.data.role })
    .where(eq(users.id, id))
    .returning()
    .get();

  if (!updated) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    data: { id: updated.id, email: updated.email, name: updated.name, role: updated.role, createdAt: updated.createdAt },
  });
}

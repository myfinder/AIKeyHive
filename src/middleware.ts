import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";

function timingSafeCompare(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  let mismatch = a.length !== b.length ? 1 : 0;
  for (let i = 0; i < maxLen; i++) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

export async function middleware(req: NextRequest) {
  // Normalize pathname to lowercase to prevent case-sensitivity bypass
  const pathname = req.nextUrl.pathname.toLowerCase();

  // Public routes
  if (
    pathname === "/" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  // Cron routes: check CRON_SECRET with timing-safe comparison
  if (pathname.startsWith("/api/cron")) {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }
    const authHeader = req.headers.get("authorization") || "";
    const expected = `Bearer ${cronSecret}`;
    if (!timingSafeCompare(authHeader, expected)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  // Auth required - check JWT token directly
  const token = await getToken({ req, secret: process.env.AUTH_SECRET });

  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/", req.url));
  }

  // Admin routes (includes /costs page)
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin") || pathname === "/costs") {
    if (token.role !== "admin") {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.svg$|.*\\.png$|.*\\.ico$).*)"],
};

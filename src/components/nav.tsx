"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
];

const adminItems = [
  { href: "/costs", label: "Costs" },
  { href: "/admin", label: "Users" },
  { href: "/admin/pool", label: "Key Pool" },
  { href: "/admin/budgets", label: "Budgets" },
];

export function Nav() {
  const pathname = usePathname();
  const { data: session } = useSession();

  if (!session?.user) return null;

  const isAdmin = session.user.role === "admin";

  return (
    <nav className="border-b bg-background">
      <div className="mx-auto flex h-14 max-w-7xl items-center px-4">
        <Link href="/dashboard" className="mr-8 text-lg font-bold">
          AIKeyHive
        </Link>

        <div className="flex items-center gap-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent",
                pathname === item.href
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground"
              )}
            >
              {item.label}
            </Link>
          ))}

          {isAdmin && (
            <>
              <span className="mx-2 text-border">|</span>
              {adminItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent",
                    pathname === item.href
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground"
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-4">
          <span className="text-sm text-muted-foreground">
            {session.user.email}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => signOut({ callbackUrl: "/" })}
          >
            Sign Out
          </Button>
        </div>
      </div>
    </nav>
  );
}

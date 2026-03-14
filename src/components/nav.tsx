"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  const [showSignOutDialog, setShowSignOutDialog] = useState(false);

  if (!session?.user) return null;

  const isAdmin = session.user.role === "admin";

  return (
    <nav className="border-b bg-background">
      <div className="mx-auto flex h-14 max-w-7xl items-center px-4">
        <Link href="/dashboard" className="mr-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-horizontal.svg" alt="AIKeyHive" className="h-9" />
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
            onClick={() => setShowSignOutDialog(true)}
          >
            Sign Out
          </Button>
        </div>
      </div>

      <Dialog open={showSignOutDialog} onOpenChange={setShowSignOutDialog}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Sign out</DialogTitle>
            <DialogDescription>
              Are you sure you want to sign out?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSignOutDialog(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => signOut({ callbackUrl: "/" })}>
              Sign Out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </nav>
  );
}

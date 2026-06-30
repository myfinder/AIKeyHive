"use client";

import { useSession, signIn, getProviders } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";

type LoginProvider = "okta" | "dev";

export default function LoginPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [loginProvider, setLoginProvider] = useState<LoginProvider | null>(null);
  const [providersLoaded, setProvidersLoaded] = useState(false);

  useEffect(() => {
    if (session?.user) {
      router.replace("/dashboard");
    }
  }, [session, router]);

  useEffect(() => {
    let cancelled = false;
    getProviders()
      .then((providers) => {
        if (cancelled) return;
        if (providers?.okta) {
          setLoginProvider("okta");
        } else if (providers?.dev) {
          setLoginProvider("dev");
        } else {
          setLoginProvider(null);
        }
      })
      .finally(() => {
        if (!cancelled) setProvidersLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "loading" || !providersLoaded) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="AIKeyHive" className="w-full max-w-sm mx-auto mb-4" />
        </CardHeader>
        <CardContent>
          <Button
            className="w-full"
            size="lg"
            disabled={!loginProvider}
            onClick={() =>
              loginProvider && signIn(loginProvider, { callbackUrl: "/dashboard" })
            }
          >
            {loginProvider === "dev" ? "Sign in locally" : "Sign in with SSO"}
          </Button>
          {!loginProvider && (
            <p className="mt-3 text-center text-sm text-muted-foreground">
              Authentication provider is not configured.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

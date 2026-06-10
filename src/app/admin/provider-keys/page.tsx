"use client";

import { Nav } from "@/components/nav";
import { ProviderKeysTable } from "@/components/provider-keys-table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function AdminProviderKeysPage() {
  return (
    <div className="flex-1 bg-background">
      <Nav />
      <main className="mx-auto max-w-7xl space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-bold">Provider Keys</h1>
          <p className="text-sm text-muted-foreground">
            All API keys that currently exist on each provider, fetched live and
            reconciled against AIKeyHive. Unmanaged keys were created outside
            AIKeyHive and can be deleted here.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>OpenAI</CardTitle>
            <CardDescription>
              All keys across the organization&apos;s projects
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProviderKeysTable provider="openai" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Anthropic</CardTitle>
            <CardDescription>
              All active keys in the organization (deleting deactivates the key)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProviderKeysTable provider="anthropic" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Gemini</CardTitle>
            <CardDescription>
              All API keys in the configured Google Cloud project
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProviderKeysTable provider="gemini" />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

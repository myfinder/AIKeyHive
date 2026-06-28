"use client";

import { useMemo, useSyncExternalStore } from "react";
import { BookOpen, Copy, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  buildOpenAiProxyBaseUrl,
  buildProxyUsageExamples,
  proxyCompatibilityNotice,
  proxyCompatibilityRows,
  type ProxyCompatibilityStatus,
  type ProxyUsageApi,
  type ProxyUsageLanguage,
} from "@/lib/proxy/how-to-use";

const fallbackOrigin = "https://your-aikeyhive.vercel.app";

const languages: Array<{ value: ProxyUsageLanguage; label: string }> = [
  { value: "python", label: "Python" },
  { value: "typescript", label: "TypeScript" },
  { value: "curl", label: "curl" },
];

const apis: Array<{
  value: ProxyUsageApi;
  label: string;
  endpoint: string;
  description: string;
}> = [
  {
    value: "responses",
    label: "Responses API",
    endpoint: "POST /responses",
    description: "Default for new OpenAI integrations.",
  },
  {
    value: "chatCompletions",
    label: "Chat Completions",
    endpoint: "POST /chat/completions",
    description: "Use for compatibility with older clients.",
  },
];

function subscribeToLocationChanges(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};

  window.addEventListener("popstate", onStoreChange);
  window.addEventListener("hashchange", onStoreChange);

  return () => {
    window.removeEventListener("popstate", onStoreChange);
    window.removeEventListener("hashchange", onStoreChange);
  };
}

function getBrowserOrigin() {
  return typeof window === "undefined" ? fallbackOrigin : window.location.origin;
}

function getServerOriginSnapshot() {
  return fallbackOrigin;
}

function useCurrentOrigin() {
  return useSyncExternalStore(
    subscribeToLocationChanges,
    getBrowserOrigin,
    getServerOriginSnapshot
  );
}

async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("Copied to clipboard");
  } catch {
    toast.error("Failed to copy");
  }
}

function CodeBlock({ value }: { value: string }) {
  return (
    <div className="relative overflow-hidden rounded-md border bg-muted/70">
      <Button
        variant="outline"
        size="sm"
        className="absolute top-2 right-2 bg-background/95"
        onClick={() => copyToClipboard(value)}
      >
        <Copy />
        Copy
      </Button>
      <pre className="max-h-[27rem] overflow-auto p-4 pr-24 text-xs leading-relaxed">
        <code>{value}</code>
      </pre>
    </div>
  );
}

function statusClass(status: ProxyCompatibilityStatus) {
  if (status === "Supported") {
    return "bg-green-100 text-green-800";
  }
  if (status === "Limited") {
    return "bg-amber-100 text-amber-900";
  }
  return "bg-muted text-muted-foreground";
}

export function ProxyKeyHowToUseDialog() {
  const origin = useCurrentOrigin();
  const baseUrl = buildOpenAiProxyBaseUrl(origin);
  const examples = useMemo(() => buildProxyUsageExamples(baseUrl), [baseUrl]);

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" />}>
        <BookOpen />
        How to use
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>How to use Proxy Keys</DialogTitle>
          <DialogDescription>
            Set the OpenAI client base URL to this proxy endpoint and use a
            Proxy Key as the API key. This is a development cost guard, not a
            full production OpenAI API proxy.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3 sm:flex-row sm:items-center">
            <div className="min-w-24 text-xs font-semibold uppercase text-muted-foreground">
              Base URL
            </div>
            <code className="flex-1 break-all text-xs">{baseUrl}</code>
            <Button
              variant="outline"
              size="sm"
              className="self-start sm:self-auto"
              onClick={() => copyToClipboard(baseUrl)}
            >
              <Copy />
              Copy
            </Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
            <Tabs defaultValue="python" className="min-w-0">
              <TabsList>
                {languages.map((language) => (
                  <TabsTrigger key={language.value} value={language.value}>
                    {language.label}
                  </TabsTrigger>
                ))}
              </TabsList>

              {languages.map((language) => (
                <TabsContent
                  key={language.value}
                  value={language.value}
                  className="mt-2"
                >
                  <Tabs defaultValue="responses">
                    <TabsList variant="line" className="h-9">
                      {apis.map((api) => (
                        <TabsTrigger key={api.value} value={api.value}>
                          {api.label}
                        </TabsTrigger>
                      ))}
                    </TabsList>

                    {apis.map((api) => (
                      <TabsContent
                        key={api.value}
                        value={api.value}
                        className="mt-3"
                      >
                        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-mono">{api.endpoint}</span>
                          <span>{api.description}</span>
                        </div>
                        <CodeBlock value={examples[language.value][api.value]} />
                      </TabsContent>
                    ))}
                  </Tabs>
                </TabsContent>
              ))}
            </Tabs>

            <div className="space-y-3 rounded-md border p-3 text-sm">
              <div>
                <div className="font-medium">Primary path</div>
                <p className="mt-1 text-muted-foreground">
                  Start with Responses API for new clients.
                </p>
              </div>
              <div>
                <div className="font-medium">Compatibility path</div>
                <p className="mt-1 text-muted-foreground">
                  Chat Completions remains available at the same proxy host.
                </p>
              </div>
              <div>
                <div className="font-medium">Budget guard</div>
                <p className="mt-1 text-muted-foreground">
                  Requests use the selected Proxy Key policy before reaching
                  OpenAI.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50/60 p-3">
            <div className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-700" />
              <div>
                <div className="font-medium text-amber-950">
                  Compatibility warning
                </div>
                <p className="mt-1 text-sm text-amber-950/80">
                  {proxyCompatibilityNotice}
                </p>
              </div>
            </div>

            <div className="overflow-hidden rounded-md border bg-background">
              <div className="grid grid-cols-[9rem_7rem_minmax(0,1fr)] border-b bg-muted/50 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
                <div>Area</div>
                <div>Status</div>
                <div>Details</div>
              </div>
              {proxyCompatibilityRows.map((row) => (
                <div
                  key={row.area}
                  className="grid grid-cols-[9rem_7rem_minmax(0,1fr)] gap-2 border-b px-3 py-2 text-sm last:border-b-0"
                >
                  <div className="font-medium">{row.area}</div>
                  <div>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(row.status)}`}
                    >
                      {row.status}
                    </span>
                  </div>
                  <div className="text-muted-foreground">{row.detail}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

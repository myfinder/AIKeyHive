"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useKeys } from "@/hooks/use-keys";

export function KeyCreateDialog() {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<string>("");
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("30");
  const [noExpiration, setNoExpiration] = useState(false);
  const [loading, setLoading] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const { mutate } = useKeys();

  const expirationDays = Number(expiresInDays);
  const expirationInvalid =
    !Number.isInteger(expirationDays) ||
    expirationDays < 1 ||
    expirationDays > 366;
  const canCreate =
    Boolean(provider) &&
    Boolean(name) &&
    (noExpiration || !expirationInvalid);

  async function handleCreate() {
    if (!canCreate) return;
    setLoading(true);

    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          noExpiration
            ? { provider, name, noExpiration: true }
            : { provider, name, expiresInDays: expirationDays }
        ),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create key");
      }

      if (data.key) {
        setCreatedKey(data.key);
      } else {
        toast.success("Key assigned successfully");
        setOpen(false);
      }
      mutate();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create key"
      );
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    setOpen(false);
    setCreatedKey(null);
    setProvider("");
    setName("");
    setExpiresInDays("30");
    setNoExpiration(false);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : handleClose())}>
      <DialogTrigger render={<Button />}>
        Create Direct Key
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Direct Key</DialogTitle>
          <DialogDescription>
            Create provider credentials for tools that require direct provider
            keys.
          </DialogDescription>
        </DialogHeader>

        {createdKey ? (
          <div className="space-y-4">
            <div className="rounded-md border bg-muted p-4">
              <p className="mb-2 text-sm font-medium text-destructive">
                Copy this key now. It will not be shown again.
              </p>
              <div className="flex items-start gap-2">
                <code className="block flex-1 break-all text-sm">{createdKey}</code>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => {
                    navigator.clipboard.writeText(createdKey);
                    toast.success("Copied to clipboard");
                  }}
                >
                  <Copy className="size-3.5" />
                  Copy
                </Button>
              </div>
            </div>
            <Button onClick={handleClose} className="w-full">
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select value={provider} onValueChange={(v) => v && setProvider(v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="gemini">Gemini</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Key Name</Label>
              <Input
                placeholder="e.g. my-project"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="direct-key-expires-in-days">
                Expiration
              </Label>
              <Input
                id="direct-key-expires-in-days"
                type="number"
                min={1}
                max={366}
                step={1}
                value={expiresInDays}
                disabled={noExpiration}
                aria-invalid={!noExpiration && expirationInvalid}
                onChange={(e) => setExpiresInDays(e.target.value)}
              />
              <p className="text-sm text-muted-foreground">
                Expiration must be between 1 and 366 days. The default is 30
                days.
              </p>
            </div>

            {provider === "anthropic" && (
              <p className="text-sm text-muted-foreground">
                Anthropic keys are assigned from the pre-provisioned pool.
              </p>
            )}

            <label className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-md border p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-primary"
                checked={noExpiration}
                onChange={(e) => setNoExpiration(e.target.checked)}
              />
              <span className="space-y-1">
                <span className="block font-medium">No expiration</span>
                <span className="block text-muted-foreground">
                  This Direct Key will not be automatically disabled by
                  AIKeyHive. Revoke it manually when it is no longer needed.
                </span>
              </span>
            </label>

            <Button
              onClick={handleCreate}
              disabled={!canCreate || loading}
              className="w-full"
            >
              {loading ? "Creating..." : "Create Direct Key"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

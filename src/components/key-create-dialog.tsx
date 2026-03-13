"use client";

import { useState } from "react";
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
  const [loading, setLoading] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const { mutate } = useKeys();

  async function handleCreate() {
    if (!provider || !name) return;
    setLoading(true);

    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, name }),
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
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : handleClose())}>
      <DialogTrigger render={<Button />}>
        Create API Key
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create API Key</DialogTitle>
          <DialogDescription>
            Create a new API key for the selected provider.
          </DialogDescription>
        </DialogHeader>

        {createdKey ? (
          <div className="space-y-4">
            <div className="rounded-md border bg-muted p-4">
              <p className="mb-2 text-sm font-medium text-destructive">
                Copy this key now. It will not be shown again.
              </p>
              <code className="block break-all text-sm">{createdKey}</code>
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

            {provider === "anthropic" && (
              <p className="text-sm text-muted-foreground">
                Anthropic keys are assigned from the pre-provisioned pool.
              </p>
            )}

            <Button
              onClick={handleCreate}
              disabled={!provider || !name || loading}
              className="w-full"
            >
              {loading ? "Creating..." : "Create Key"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

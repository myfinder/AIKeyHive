"use client";

import { useId, useState } from "react";
import { CircleHelp, Copy } from "lucide-react";
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
import { toast } from "sonner";
import { useProxyKeys } from "@/hooks/use-keys";
import {
  defaultAllowedModelsCsv,
  proxyKeyFormFieldHelp,
} from "@/lib/proxy/model-policy";
import { isHelpTooltipOpen } from "@/lib/ui/help-tooltip-state";

type ProxyKeyForm = {
  name: string;
  allowedModels: string;
  hourlyLimitUsd: string;
  dailyLimitUsd: string;
  monthlyLimitUsd: string;
  maxRequestUsd: string;
  maxOutputTokens: string;
  maxConcurrency: string;
};

const defaultForm: ProxyKeyForm = {
  name: "",
  allowedModels: defaultAllowedModelsCsv,
  hourlyLimitUsd: "5",
  dailyLimitUsd: "20",
  monthlyLimitUsd: "100",
  maxRequestUsd: "1",
  maxOutputTokens: "4096",
  maxConcurrency: "2",
};

const numericFields: Array<{
  key: keyof Omit<ProxyKeyForm, "name" | "allowedModels">;
  label: string;
  help: string;
  step?: string;
  min?: string;
  max?: string;
}> = [
  {
    key: "hourlyLimitUsd",
    label: "Hourly limit USD",
    help: proxyKeyFormFieldHelp.hourlyLimitUsd,
    step: "0.01",
    min: "0",
  },
  {
    key: "dailyLimitUsd",
    label: "Daily limit USD",
    help: proxyKeyFormFieldHelp.dailyLimitUsd,
    step: "0.01",
    min: "0",
  },
  {
    key: "monthlyLimitUsd",
    label: "Monthly limit USD",
    help: proxyKeyFormFieldHelp.monthlyLimitUsd,
    step: "0.01",
    min: "0",
  },
  {
    key: "maxRequestUsd",
    label: "Max request USD",
    help: proxyKeyFormFieldHelp.maxRequestUsd,
    step: "0.01",
    min: "0",
  },
  {
    key: "maxOutputTokens",
    label: "Max output tokens",
    help: proxyKeyFormFieldHelp.maxOutputTokens,
    step: "1",
    min: "1",
  },
  {
    key: "maxConcurrency",
    label: "Max concurrency",
    help: proxyKeyFormFieldHelp.maxConcurrency,
    step: "1",
    min: "1",
    max: "10",
  },
];

function HelpTooltip({ label, help }: { label: string; help: string }) {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = isHelpTooltipOpen({ hovered, pinned });

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        aria-label={`${label} details`}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={() => setPinned((current) => !current)}
        onBlur={() => setPinned(false)}
      >
        <CircleHelp className="size-3.5" />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute bottom-full left-1/2 z-[80] mb-2 w-72 max-w-[min(18rem,calc(100vw-2rem))] -translate-x-1/2 rounded-md bg-foreground px-3 py-2 text-xs leading-relaxed text-background shadow-md"
        >
          {help}
        </span>
      )}
    </span>
  );
}

function FieldLabel({ label, help }: { label: string; help: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Label>{label}</Label>
      <HelpTooltip label={label} help={help} />
    </div>
  );
}

function parsePositiveNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parsePositiveInteger(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function readJsonObject(res: Response) {
  try {
    const data: unknown = await res.json();
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

function responseErrorMessage(data: object | null, fallback: string) {
  if (
    data &&
    "error" in data &&
    typeof data.error === "string" &&
    data.error
  ) {
    return data.error;
  }
  return fallback;
}

export function ProxyKeyCreateDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ProxyKeyForm>(defaultForm);
  const [loading, setLoading] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const { mutate } = useProxyKeys();

  function updateField(key: keyof ProxyKeyForm, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function buildPayload() {
    const name = form.name.trim();
    if (name.length > 100) {
      throw new Error("Name must be 100 characters or fewer");
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error(
        "Name may only contain letters, numbers, hyphens, and underscores"
      );
    }

    const allowedModels = form.allowedModels
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean);
    if (allowedModels.length === 0) {
      throw new Error("Add at least one allowed model");
    }

    const hourlyLimitUsd = parsePositiveNumber(form.hourlyLimitUsd);
    const dailyLimitUsd = parsePositiveNumber(form.dailyLimitUsd);
    const monthlyLimitUsd = parsePositiveNumber(form.monthlyLimitUsd);
    const maxRequestUsd = parsePositiveNumber(form.maxRequestUsd);
    const maxOutputTokens = parsePositiveInteger(form.maxOutputTokens);
    const maxConcurrency = parsePositiveInteger(form.maxConcurrency);

    if (
      hourlyLimitUsd === null ||
      dailyLimitUsd === null ||
      monthlyLimitUsd === null ||
      maxRequestUsd === null ||
      maxOutputTokens === null ||
      maxConcurrency === null
    ) {
      throw new Error("Limits must be positive numbers");
    }

    if (maxConcurrency > 10) {
      throw new Error("Max concurrency must be 10 or less");
    }

    if (hourlyLimitUsd > dailyLimitUsd || dailyLimitUsd > monthlyLimitUsd) {
      throw new Error("Budget limits must increase from hourly to monthly");
    }

    return {
      name,
      allowedModels,
      hourlyLimitUsd,
      dailyLimitUsd,
      monthlyLimitUsd,
      maxRequestUsd,
      maxOutputTokens,
      maxConcurrency,
    };
  }

  async function handleCreate() {
    let payload: ReturnType<typeof buildPayload>;
    try {
      payload = buildPayload();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Invalid proxy key policy"
      );
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/proxy-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await readJsonObject(res);

      if (!res.ok) {
        throw new Error(responseErrorMessage(data, "Failed to create proxy key"));
      }

      if (!data || !("key" in data) || typeof data.key !== "string") {
        throw new Error("Proxy key response did not include a one-time key");
      }

      setCreatedKey(data.key);
      mutate();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create proxy key"
      );
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    setOpen(false);
    setCreatedKey(null);
    setForm(defaultForm);
  }

  return (
    <Dialog
      open={open}
      disablePointerDismissal={!!createdKey}
      onOpenChange={(value, eventDetails) => {
        if (!value && createdKey) {
          eventDetails.cancel();
          return;
        }
        if (value) {
          setOpen(true);
        } else {
          handleClose();
        }
      }}
    >
      <DialogTrigger render={<Button />}>Create Proxy Key</DialogTrigger>
      <DialogContent className="sm:max-w-2xl" showCloseButton={!createdKey}>
        <DialogHeader>
          <DialogTitle>Create Proxy Key</DialogTitle>
          <DialogDescription>
            Create a virtual key with model, budget, token, and concurrency
            limits enforced by AIKeyHive.
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
                  <Copy />
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
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <FieldLabel label="Name" help={proxyKeyFormFieldHelp.name} />
                <Input
                  placeholder="team-prod"
                  maxLength={100}
                  value={form.name}
                  onChange={(event) => updateField("name", event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <FieldLabel
                  label="Allowed models"
                  help={proxyKeyFormFieldHelp.allowedModels}
                />
                <Input
                  value={form.allowedModels}
                  onChange={(event) =>
                    updateField("allowedModels", event.target.value)
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Example:{" "}
                  <span className="font-mono">{defaultAllowedModelsCsv}</span>
                </p>
              </div>
              {numericFields.map((field) => (
                <div key={field.key} className="space-y-2">
                  <FieldLabel label={field.label} help={field.help} />
                  <Input
                    type="number"
                    step={field.step}
                    min={field.min}
                    max={field.max}
                    value={form[field.key]}
                    onChange={(event) =>
                      updateField(field.key, event.target.value)
                    }
                  />
                </div>
              ))}
            </div>

            <Button
              onClick={handleCreate}
              disabled={
                loading ||
                !form.name.trim() ||
                !form.allowedModels.trim()
              }
              className="w-full"
            >
              {loading ? "Creating..." : "Create Proxy Key"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

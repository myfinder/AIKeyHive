"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { ChevronDown, CircleHelp, Copy } from "lucide-react";
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
import { useProxyKeys, useProxyModelCatalog } from "@/hooks/use-keys";
import {
  defaultAllowedModelsCsv,
  proxyKeyFormFieldHelp,
} from "@/lib/proxy/model-policy";
import { isHelpTooltipOpen } from "@/lib/ui/help-tooltip-state";
import {
  filterProxyModels,
  formatModelPriceLine,
  selectedModelsSummary,
} from "@/lib/proxy/model-catalog";

type ProxyKeyForm = {
  name: string;
  allowedModels: string[];
  hourlyLimitUsd: string;
  dailyLimitUsd: string;
  monthlyLimitUsd: string;
  maxRequestUsd: string;
  maxOutputTokens: string;
  maxConcurrency: string;
};

const defaultAllowedModels = defaultAllowedModelsCsv
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);

const defaultForm: ProxyKeyForm = {
  name: "",
  allowedModels: [],
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
  const [initializedModelSelection, setInitializedModelSelection] =
    useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const { mutate } = useProxyKeys();
  const {
    models: proxyModels,
    isLoading: proxyModelsLoading,
    isError: proxyModelsError,
  } = useProxyModelCatalog();

  const availableModelSet = useMemo(
    () => new Set(proxyModels.map((model) => model.model)),
    [proxyModels]
  );
  const filteredProxyModels = useMemo(
    () => filterProxyModels(proxyModels, modelSearch),
    [modelSearch, proxyModels]
  );
  const allowedModelsSummary = selectedModelsSummary(form.allowedModels);

  useEffect(() => {
    if (!open || initializedModelSelection || proxyModels.length === 0) {
      return;
    }

    setForm((current) => {
      const currentAvailableSelection = current.allowedModels.filter((model) =>
        availableModelSet.has(model)
      );
      const defaultAvailableSelection = defaultAllowedModels.filter((model) =>
        availableModelSet.has(model)
      );

      return {
        ...current,
        allowedModels:
          currentAvailableSelection.length > 0
            ? currentAvailableSelection
            : defaultAvailableSelection,
      };
    });
    setInitializedModelSelection(true);
  }, [availableModelSet, initializedModelSelection, open, proxyModels.length]);

  function updateField(
    key: keyof Omit<ProxyKeyForm, "allowedModels">,
    value: string
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleAllowedModel(model: string, checked: boolean) {
    setForm((current) => {
      const selected = new Set(current.allowedModels);
      if (checked) {
        selected.add(model);
      } else {
        selected.delete(model);
      }

      return {
        ...current,
        allowedModels: proxyModels
          .map((item) => item.model)
          .filter((itemModel) => selected.has(itemModel)),
      };
    });
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

    const allowedModels = form.allowedModels.filter(Boolean);
    if (allowedModels.length === 0) {
      throw new Error("Select at least one allowed model");
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
    setInitializedModelSelection(false);
    setModelDropdownOpen(false);
    setModelSearch("");
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
                <div className="relative">
                  <button
                    type="button"
                    className="flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-background px-3 text-left text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    aria-expanded={modelDropdownOpen}
                    disabled={
                      proxyModelsLoading ||
                      proxyModelsError ||
                      proxyModels.length === 0
                    }
                    onClick={() =>
                      setModelDropdownOpen((current) => !current)
                    }
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 font-medium">
                        {form.allowedModels.length} selected
                      </span>
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {allowedModelsSummary}
                      </span>
                    </span>
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                  </button>

                  {modelDropdownOpen && (
                    <div className="absolute top-10 right-0 left-0 z-[90] overflow-hidden rounded-md border bg-background shadow-lg">
                      <div className="border-b p-2">
                        <Input
                          placeholder="Search model..."
                          value={modelSearch}
                          onChange={(event) =>
                            setModelSearch(event.target.value)
                          }
                        />
                      </div>
                      <div className="max-h-72 overflow-y-auto">
                        {filteredProxyModels.length === 0 ? (
                          <p className="px-3 py-2 text-sm text-muted-foreground">
                            No matching models.
                          </p>
                        ) : (
                          filteredProxyModels.map((model) => (
                            <label
                              key={model.model}
                              className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-b px-3 py-2 last:border-b-0 hover:bg-muted/60"
                            >
                              <input
                                type="checkbox"
                                className="size-4 accent-primary"
                                checked={form.allowedModels.includes(
                                  model.model
                                )}
                                onChange={(event) =>
                                  toggleAllowedModel(
                                    model.model,
                                    event.target.checked
                                  )
                                }
                              />
                              <span className="min-w-0">
                                <span className="block truncate font-mono text-sm">
                                  {model.model}
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {formatModelPriceLine(model)}
                                </span>
                              </span>
                            </label>
                          ))
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2 border-t p-2">
                        <span className="text-xs text-muted-foreground">
                          Showing models with active OpenAI prices.
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => setModelDropdownOpen(false)}
                        >
                          Apply
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
                {proxyModelsLoading && (
                  <p className="text-xs text-muted-foreground">
                    Loading models...
                  </p>
                )}
                {proxyModelsError && (
                  <p className="text-xs text-destructive">
                    Failed to load priced models.
                  </p>
                )}
                {!proxyModelsLoading &&
                  !proxyModelsError &&
                  proxyModels.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No active priced models are available.
                    </p>
                  )}
                {form.allowedModels.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {form.allowedModels.map((model) => (
                      <button
                        key={model}
                        type="button"
                        className="inline-flex min-h-6 max-w-full items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-xs hover:bg-muted"
                        onClick={() => toggleAllowedModel(model, false)}
                      >
                        <span className="truncate">{model}</span>
                        <span className="font-sans text-muted-foreground">
                          x
                        </span>
                      </button>
                    ))}
                  </div>
                )}
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
                proxyModelsLoading ||
                proxyModelsError ||
                proxyModels.length === 0 ||
                !form.name.trim() ||
                form.allowedModels.length === 0
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

export type ProxyModelCatalogItem = {
  provider: "openai";
  model: string;
  inputUsdPer1m: number;
  cachedInputUsdPer1m: number | null;
  outputUsdPer1m: number;
};

function formatUsd(value: number | null) {
  if (value === null) {
    return "n/a";
  }
  const twoDecimal = value.toFixed(2);
  if (Number(twoDecimal) === value) {
    return `$${twoDecimal}`;
  }
  return `$${value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;
}

export function formatModelPriceLine(model: ProxyModelCatalogItem) {
  return `input ${formatUsd(model.inputUsdPer1m)} / cached ${formatUsd(
    model.cachedInputUsdPer1m
  )} / output ${formatUsd(model.outputUsdPer1m)} per 1M tokens`;
}

export function filterProxyModels(
  models: ProxyModelCatalogItem[],
  query: string
) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return models;
  }

  return models.filter((model) =>
    model.model.toLowerCase().includes(normalizedQuery)
  );
}

export function selectedModelsSummary(selectedModels: string[]) {
  if (selectedModels.length === 0) {
    return "Select models";
  }
  return selectedModels.join(", ");
}

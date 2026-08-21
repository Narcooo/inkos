export interface ProductionRoleSelection {
  readonly writer: string;
  readonly logicAuditor: string;
  readonly commercialReader: string;
  readonly reviser: string;
  readonly observerReflector: string;
}

export const PRODUCTION_ROLE_KEYS = [
  "writer",
  "logicAuditor",
  "commercialReader",
  "reviser",
  "observerReflector",
] as const;

export interface ProductionModelCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly contextWindow: number;
  readonly inputPrice?: string;
  readonly outputPrice?: string;
  readonly maxOutputTokens?: number;
  readonly inputModalities?: ReadonlyArray<string>;
  readonly outputModalities?: ReadonlyArray<string>;
  readonly supportedParameters?: ReadonlyArray<string>;
}

export interface BoundProductionRolePricing {
  readonly modelId: string;
  readonly status: "VERIFIED_IN_CURRENT_CATALOG" | "MODEL_NOT_IN_CURRENT_CATALOG" | "PRICING_UNAVAILABLE";
  readonly inputUsdPerToken: number | null;
  readonly outputUsdPerToken: number | null;
  readonly pricingUnit: "USD_PER_TOKEN";
  readonly contextWindow: number | null;
  readonly maxOutputTokens: number | null;
}

const EXPLICIT_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*\/[A-Za-z0-9][A-Za-z0-9._:+-]*$/;

export function searchProductionModelCatalog(
  models: ReadonlyArray<ProductionModelCatalogEntry>,
  query: string,
): ReadonlyArray<ProductionModelCatalogEntry> {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return models;
  return models.filter((model) => `${model.id}\n${model.name}`.toLocaleLowerCase().includes(normalized));
}

export function isTextGenerationCatalogModel(model: ProductionModelCatalogEntry): boolean {
  return model.inputModalities?.includes("text") === true && model.outputModalities?.includes("text") === true;
}

export function validateProductionRoleSelection(
  selection: ProductionRoleSelection,
  registeredModels: ReadonlyArray<string>,
): ProductionRoleSelection {
  const registered = new Set(registeredModels);
  const normalized = {} as Record<keyof ProductionRoleSelection, string>;
  for (const role of PRODUCTION_ROLE_KEYS) {
    const model = selection[role]?.trim();
    if (!model) throw new Error(`Production role ${role} model is required.`);
    if (!registered.has(model) && !EXPLICIT_MODEL_ID.test(model)) throw new Error(`Production role ${role} model ID must be registered or an explicit provider/model slug.`);
    normalized[role] = model;
  }
  return normalized;
}

export function buildProductionRoleOverrides(
  selection: ProductionRoleSelection,
  existingOverrides: Readonly<Record<string, unknown>>,
) {
  return {
    defaultModel: selection.writer,
    modelOverrides: {
      ...existingOverrides,
      auditor: selection.logicAuditor,
      "commercial-reader": selection.commercialReader,
      reviser: selection.reviser,
      "observer-reflector": selection.observerReflector,
    },
  };
}

function finiteNonNegativePrice(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function bindProductionRolePricing(
  selection: ProductionRoleSelection,
  catalog: ReadonlyArray<ProductionModelCatalogEntry>,
): Readonly<Record<keyof ProductionRoleSelection, BoundProductionRolePricing>> {
  const byId = new Map(catalog.map((model) => [model.id, model]));
  const result = {} as Record<keyof ProductionRoleSelection, BoundProductionRolePricing>;
  for (const role of PRODUCTION_ROLE_KEYS) {
    const modelId = selection[role];
    const model = byId.get(modelId);
    const inputUsdPerToken = finiteNonNegativePrice(model?.inputPrice);
    const outputUsdPerToken = finiteNonNegativePrice(model?.outputPrice);
    result[role] = {
      modelId,
      status: !model
        ? "MODEL_NOT_IN_CURRENT_CATALOG"
        : inputUsdPerToken === null || outputUsdPerToken === null
          ? "PRICING_UNAVAILABLE"
          : "VERIFIED_IN_CURRENT_CATALOG",
      inputUsdPerToken,
      outputUsdPerToken,
      pricingUnit: "USD_PER_TOKEN",
      contextWindow: model && Number.isFinite(model.contextWindow) && model.contextWindow > 0 ? model.contextWindow : null,
      maxOutputTokens: model?.maxOutputTokens !== undefined && Number.isFinite(model.maxOutputTokens) && model.maxOutputTokens > 0
        ? model.maxOutputTokens
        : null,
    };
  }
  return result;
}

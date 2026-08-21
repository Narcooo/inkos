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
  readonly inputModalities?: ReadonlyArray<string>;
  readonly outputModalities?: ReadonlyArray<string>;
  readonly supportedParameters?: ReadonlyArray<string>;
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

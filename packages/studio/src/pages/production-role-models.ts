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

export function validateProductionRoleSelection(
  selection: ProductionRoleSelection,
  registeredModels: ReadonlyArray<string>,
): ProductionRoleSelection {
  const allowed = new Set(registeredModels);
  for (const role of PRODUCTION_ROLE_KEYS) {
    const model = selection[role]?.trim();
    if (!model || !allowed.has(model)) {
      throw new Error(`Production role ${role} model is not registered for the connected Studio service.`);
    }
  }
  return selection;
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

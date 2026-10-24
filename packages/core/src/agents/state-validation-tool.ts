import { Type } from "@sinclair/typebox";

export const StateValidationToolSchema = Type.Object({
  reconciliationRequired: Type.Boolean({
    description: "True only when recalculating the derived truth projection can resolve the mismatch. False for contradictions in prose or between authority sources.",
  }),
  reportMarkdown: Type.String({description:"Concise readable findings with source evidence. Explain every required projection correction and any unresolved authority conflict. Return an empty string when there are no findings."}),
});

export const StateProjectionReviewToolSchema = Type.Object({
  corrections: Type.Array(Type.Object({
    targetId: Type.String({description:"An exact proposed record ID, or missing-state-fact / missing-hook for a necessary missing entry."}),
    reason: Type.String({minLength:1}),
    sourceRefs: Type.Array(Type.Object({
      sourceId: Type.Literal('chapter'),
      startLine: Type.Integer({minimum:1}),
      endLine: Type.Integer({minimum:1}),
    }, {additionalProperties:false}), {minItems:1}),
  }, {additionalProperties:false})),
  observations: Type.String({description:"Source conflicts or uncertainty that cannot be repaired in the projection. Empty when there are no such observations."}),
}, {additionalProperties:false});

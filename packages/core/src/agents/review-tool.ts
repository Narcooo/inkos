import { Type } from "@sinclair/typebox";

const ReviewCategory=Type.Union([Type.Literal('quality'),Type.Literal('execution'),Type.Literal('scope')],{
  description:"quality: findings about the artifact's content, including factual and arithmetic errors. execution: evidence of whether a tool or external operation completed, not actions described within the story. scope: verified changes outside the author's authorized revision region, citing before/current sources.",
});

export const ObservationToolSchema = Type.Object({
  code: Type.String({ minLength: 1 }),
  assessment: Type.Optional(Type.Union([Type.Literal("issue"), Type.Literal("resolved"), Type.Literal("observation")], { description: "Whether the evidence identifies a defect, verifies a previously identified issue was resolved, or records a neutral observation." })),
  summary: Type.String({ minLength: 1 }),
  evidence: Type.Array(Type.String({ minLength: 1 })),
});

export const SourcedReviewToolSchema = Type.Object({
  summary: Type.String(),
  observations: Type.Array(Type.Object({
    code: Type.String({ minLength: 1 }), summary: Type.String({ minLength: 1 }),
    assessment: Type.Union([Type.Literal("issue"), Type.Literal("resolved"), Type.Literal("observation"), Type.Literal("unavailable")], {description:"Use unavailable when a requested comparison lacks its source or execution evidence; missing evidence is not a content defect."}),
    evidence: Type.Array(Type.String()),
    sourceRefs: Type.Array(Type.Union([
      Type.Object({ sourceId: Type.String(), startLine: Type.Integer({minimum:1}), endLine: Type.Integer({minimum:1}) },
        {additionalProperties:false,description:"Preferred: select a short inclusive line range from the numbered source. The host copies the exact original excerpt."}),
      Type.Object({ sourceId: Type.String(), quote: Type.String({ minLength: 1, description: "Alternative: exact verbatim text from the named source, preserving punctuation." }) }, {additionalProperties:false}),
    ]), { description: "Cite supplied source evidence. May be empty only for an unavailable assessment." }),
  })),
});

export const SourcedReviewIndexToolSchema=Type.Object({
  summary:Type.String(),
  observations:Type.Array(Type.Object({
    code:Type.String({minLength:1}),
    summary:Type.String({minLength:1,description:"Explain this finding concisely using the selected evidence and its effect on the story. The explanation and assessment must describe the same finding."}),
    assessment:SourcedReviewToolSchema.properties.observations.items.properties.assessment,
    category:Type.Optional(ReviewCategory),
    sourceRefs:Type.Array(Type.Object({sourceId:Type.String(),startLine:Type.Integer({minimum:1}),endLine:Type.Integer({minimum:1})},{additionalProperties:false}),{description:"Select nonempty source line ranges. May be empty only for an unavailable assessment."}),
  },{additionalProperties:false})),
});

export const ArtifactReviewIndexToolSchema = Type.Object({
  ...SourcedReviewIndexToolSchema.properties,
  observations: Type.Array(Type.Object({
    ...SourcedReviewIndexToolSchema.properties.observations.items.properties,
    category: ReviewCategory,
  }, { additionalProperties: false })),
});

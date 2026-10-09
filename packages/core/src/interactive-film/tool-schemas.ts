import { Type, type Static } from "@sinclair/typebox";

const VarValueToolSchema = Type.Union([Type.Number(), Type.String(), Type.Boolean()]);

export const ConditionToolSchema = Type.Object({
  var: Type.String({ minLength: 1 }),
  op: Type.Union([
    Type.Literal(">="),
    Type.Literal("<="),
    Type.Literal(">"),
    Type.Literal("<"),
    Type.Literal("=="),
    Type.Literal("!="),
  ]),
  value: VarValueToolSchema,
}, { additionalProperties: false });

const EffectToolSchema = Type.Object({
  var: Type.String({ minLength: 1 }),
  op: Type.Union([Type.Literal("set"), Type.Literal("add"), Type.Literal("sub")]),
  value: VarValueToolSchema,
}, { additionalProperties: false });

export const ChoiceToolSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  text: Type.String(),
  targetNodeId: Type.String({ minLength: 1 }),
  condition: Type.Optional(ConditionToolSchema),
  effects: Type.Array(EffectToolSchema),
  weight: Type.Optional(Type.String()),
}, { additionalProperties: false });

const DialogueLineToolSchema = Type.Object({
  speaker: Type.String(),
  text: Type.String(),
  emotion: Type.String(),
  condition: Type.Optional(ConditionToolSchema),
}, { additionalProperties: false });

const ImageSlotToolSchema = Type.Object({
  prompt: Type.String(),
  assetRef: Type.Optional(Type.String()),
}, { additionalProperties: false });

const NodeTypeToolSchema = Type.Union([
  Type.Literal("start"),
  Type.Literal("normal"),
  Type.Literal("branch"),
  Type.Literal("merge"),
  Type.Literal("ending"),
  Type.Literal("explore"),
], {
  description: "Exactly one node is start. A start node may present the opening choices. Use branch for a dedicated later decision scene, ending for terminal outcomes, and normal/explore/merge for other scenes.",
});

const StoryNodeFields = {
  title: Type.String(),
  type: NodeTypeToolSchema,
  sceneDesc: Type.String({description:"Always-visible scene description. At shared nodes it must be true for every incoming state. Put state-specific spoken facts in dialogue entries with an explicit condition."}),
  dialogue: Type.Array(DialogueLineToolSchema),
  choices: Type.Array(ChoiceToolSchema),
  imageSlot: Type.Optional(ImageSlotToolSchema),
  act: Type.String(),
  position: Type.Optional(Type.Object({
    x: Type.Number(),
    y: Type.Number(),
  }, { additionalProperties: false })),
};

export const StoryNodeContentToolSchema = Type.Object(StoryNodeFields, {
  additionalProperties: false,
});

export const StoryNodeRevisionToolSchema = Type.Object({
  title: StoryNodeFields.title,
  sceneDesc: StoryNodeFields.sceneDesc,
  dialogue: StoryNodeFields.dialogue,
}, {additionalProperties: false});

export const StoryNodeToolSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  ...StoryNodeFields,
}, { additionalProperties: false });

const WorldAnchorToolSchema = Type.Object({
  storyCore: Type.String(),
  theme: Type.String(),
  genre: Type.String(),
  worldRules: Type.String(),
  durationMinutes: Type.Number({ minimum: 0 }),
}, { additionalProperties: false });

const CharacterToolSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String(),
  role: Type.String(),
  motivation: Type.String(),
  voiceProfile: Type.Optional(Type.Object({
    speakingRhythm: Type.String(),
    vocabulary: Type.String(),
    sampleLines: Type.Array(Type.String()),
  }, { additionalProperties: false })),
}, { additionalProperties: false });

const VariableToolSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  type: Type.String(),
  default: VarValueToolSchema,
  desc: Type.String(),
}, { additionalProperties: false });

const EndingToolSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  nodeId: Type.String({ minLength: 1 }),
  title: Type.String(),
  type: Type.String(),
  description: Type.String(),
}, { additionalProperties: false });

export const StoryGraphContentToolSchema = Type.Object({
  worldAnchor: WorldAnchorToolSchema,
  characters: Type.Array(CharacterToolSchema),
  variables: Type.Array(VariableToolSchema),
  nodes: Type.Array(StoryNodeToolSchema, { minItems: 3 }),
  endings: Type.Array(EndingToolSchema, { minItems: 1 }),
}, { additionalProperties: false });

export const StoryStructureToolSchema = Type.Object({
  nodes: Type.Array(StoryNodeToolSchema, { minItems: 1 }),
}, { additionalProperties: false });

export type StoryNodeContentSubmission = Static<typeof StoryNodeContentToolSchema>;
export type StoryStructureSubmission = Static<typeof StoryStructureToolSchema>;
export type StoryGraphContentSubmission = Static<typeof StoryGraphContentToolSchema>;

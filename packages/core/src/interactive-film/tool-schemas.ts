import { Type, type Static } from "@sinclair/typebox";

const VarValueToolSchema = Type.Union([Type.Number(), Type.String(), Type.Boolean()]);

const ConditionToolSchema = Type.Object({
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

const ChoiceToolSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  text: Type.String(),
  targetNodeId: Type.String({ minLength: 1 }),
  condition: Type.Optional(ConditionToolSchema),
  effects: Type.Optional(Type.Array(EffectToolSchema)),
  weight: Type.Optional(Type.Union([
    Type.Literal("light"),
    Type.Literal("heavy"),
    Type.Literal("critical"),
  ])),
}, { additionalProperties: false });

const DialogueLineToolSchema = Type.Object({
  speaker: Type.String(),
  text: Type.String(),
  emotion: Type.Optional(Type.String()),
}, { additionalProperties: false });

const ImageSlotToolSchema = Type.Object({
  prompt: Type.Optional(Type.String()),
  assetRef: Type.Optional(Type.String()),
}, { additionalProperties: false });

const NodeTypeToolSchema = Type.Union([
  Type.Literal("start"),
  Type.Literal("normal"),
  Type.Literal("branch"),
  Type.Literal("merge"),
  Type.Literal("ending"),
  Type.Literal("explore"),
]);

const StoryNodeFields = {
  title: Type.Optional(Type.String()),
  type: NodeTypeToolSchema,
  sceneDesc: Type.Optional(Type.String()),
  dialogue: Type.Optional(Type.Array(DialogueLineToolSchema)),
  choices: Type.Optional(Type.Array(ChoiceToolSchema)),
  imageSlot: Type.Optional(ImageSlotToolSchema),
  act: Type.Optional(Type.String()),
  position: Type.Optional(Type.Object({
    x: Type.Number(),
    y: Type.Number(),
  }, { additionalProperties: false })),
};

export const StoryNodeContentToolSchema = Type.Object(StoryNodeFields, {
  additionalProperties: false,
});

export const StoryNodeToolSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  ...StoryNodeFields,
}, { additionalProperties: false });

const WorldAnchorToolSchema = Type.Object({
  storyCore: Type.Optional(Type.String()),
  theme: Type.Optional(Type.String()),
  genre: Type.Optional(Type.String()),
  worldRules: Type.Optional(Type.String()),
  durationMinutes: Type.Optional(Type.Number({ minimum: 0 })),
}, { additionalProperties: false });

const CharacterToolSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String(),
  role: Type.Optional(Type.Union([
    Type.Literal("protagonist"),
    Type.Literal("antagonist"),
    Type.Literal("support"),
    Type.Literal("other"),
  ])),
  motivation: Type.Optional(Type.String()),
  voiceProfile: Type.Optional(Type.Object({
    speakingRhythm: Type.Optional(Type.String()),
    vocabulary: Type.Optional(Type.String()),
    sampleLines: Type.Optional(Type.Array(Type.String())),
  }, { additionalProperties: false })),
}, { additionalProperties: false });

const VariableToolSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  type: Type.Union([
    Type.Literal("flag"),
    Type.Literal("counter"),
    Type.Literal("relationship"),
    Type.Literal("item"),
  ]),
  default: VarValueToolSchema,
  desc: Type.Optional(Type.String()),
}, { additionalProperties: false });

const EndingToolSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  nodeId: Type.String({ minLength: 1 }),
  title: Type.String(),
  type: Type.Union([
    Type.Literal("good"),
    Type.Literal("bad"),
    Type.Literal("neutral"),
    Type.Literal("secret"),
  ]),
  description: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const StoryGraphContentToolSchema = Type.Object({
  worldAnchor: Type.Optional(WorldAnchorToolSchema),
  characters: Type.Optional(Type.Array(CharacterToolSchema)),
  variables: Type.Optional(Type.Array(VariableToolSchema)),
  nodes: Type.Array(StoryNodeToolSchema, { minItems: 5 }),
  endings: Type.Array(EndingToolSchema, { minItems: 2 }),
}, { additionalProperties: false });

export const StoryStructureToolSchema = Type.Object({
  nodes: Type.Array(StoryNodeToolSchema, { minItems: 1 }),
}, { additionalProperties: false });

export type StoryNodeContentSubmission = Static<typeof StoryNodeContentToolSchema>;
export type StoryStructureSubmission = Static<typeof StoryStructureToolSchema>;

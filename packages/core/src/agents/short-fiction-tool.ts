import { Type } from "@sinclair/typebox";

export function shortOutlineToolSchema(chapterCount:number,title?:string) {
  return Type.Object({
    storyTitle:title?.trim()?Type.Literal(title.trim()):Type.String({minLength:1}),
    planMarkdown:Type.String({minLength:1,description:"Shared premise, protagonist and central conflict. Do not repeat the chapter plans here."}),
    ...Object.fromEntries(Array.from({length:chapterCount},(_,index)=>[`chapter_${index+1}_plan`,Type.String({minLength:1,description:`Chapter ${index+1}: a concise complete scene plan, about 150–250 Chinese characters or 80–120 English words. State the action, conflict, causal evidence, payoff and transition; keep later chapters' events in their own plans.`})])),
  },{additionalProperties:false});
}

export const ShortDraftBatchToolSchema = Type.Object({
  storyTitle: Type.String({ minLength: 1 }),
  openingHook: Type.Optional(Type.String()),
  chapters: Type.Array(Type.Object({
    number: Type.Integer({ minimum: 1 }),
    title: Type.String({ minLength: 1, description: "Chapter title only; do not include a chapter number or heading prefix." }),
    content: Type.String({ minLength: 1 }),
  })),
});

export const ShortDraftChapterToolSchema = Type.Object({
  storyTitle: Type.String({ minLength: 1 }),
  openingHook: Type.Optional(Type.String()),
  number: Type.Integer({ minimum: 1 }),
  title: Type.String({ minLength: 1, description: "Chapter title without a number or heading prefix." }),
  content: Type.String({ minLength: 1, description: "Complete prose of the requested chapter." }),
});

export const ShortRevisionChapterToolSchema = Type.Object({
  title: ShortDraftChapterToolSchema.properties.title,
  content: ShortDraftChapterToolSchema.properties.content,
}, { additionalProperties: false });

/** Long chapter prose is submitted once as flat strings, never nested JSON strings. */
export function shortDraftBatchToolSchema(chapterNumbers: readonly number[], options?:{title?:string;openingHookChars?:number}) {
  return Type.Object({
    storyTitle: options?.title?.trim()?Type.Literal(options.title.trim()):Type.String({ minLength: 1 }),
    openingHook: options?.openingHookChars&&chapterNumbers.includes(1)
      ? Type.String({minLength:1,description:`Independent opening scene, about ${options.openingHookChars} native language units, before chapter one. Keep the complete first chapter separately.`})
      : Type.Optional(Type.String()),
    ...Object.fromEntries(chapterNumbers.flatMap(number => [
      [`chapter_${number}_title`, Type.String({ minLength: 1, description: `Chapter ${number} title, without numbering.` })],
      [`chapter_${number}_content`, Type.String({ minLength: 1, description: `Complete chapter ${number} prose. Submit the text directly, not a JSON document.` })],
    ])),
  }, { additionalProperties: false });
}

export const ShortPackageToolSchema = Type.Object({
  title: Type.String({ minLength: 1 }),
  intro: Type.String({ minLength: 1 }),
  sellingPoints: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  coverPrompt: Type.String({ minLength: 1 }),
});

export const ShortRevisionPlanSchema = Type.Object({
  storyTitle: Type.Optional(Type.String({minLength:1,description:'Revised book title grounded in the current manuscript, only when explicitly authorized by the author. Omit to preserve it.'})),
  revisionBrief: Type.String({minLength:1,description:"Resolve shared facts and event order once for the selected revision. State the chosen corrections that all affected chapters must follow, rather than repeating unresolved alternatives. Preserve author constraints and facts outside the requested change."}),
  outlineMarkdown: Type.Optional(Type.String({minLength:1,description:"Update the complete outline when it contradicts the chosen, authorized corrections. Omit when it remains valid, including local prose edits. Preserve unrelated events and structure."})),
  openingHook: Type.Optional(Type.String()),
  chapters: Type.Array(Type.Object({
    number:Type.Integer({minimum:1}),
    sourceNumber:Type.Optional(Type.Integer({minimum:0})),
    instruction:Type.Optional(Type.String({minLength:1})),
  })),
});

export function shortRevisionPlanSubmissionSchema(chapterCount:number,sourceChapterCount=chapterCount,allowStoryTitle=false) {
  return Type.Object({
    ...(allowStoryTitle?{storyTitle:ShortRevisionPlanSchema.properties.storyTitle}:{}),
    revisionBrief:ShortRevisionPlanSchema.properties.revisionBrief,
    outlineMarkdown:ShortRevisionPlanSchema.properties.outlineMarkdown,
    openingHook:ShortRevisionPlanSchema.properties.openingHook,
    ...Object.fromEntries(Array.from({length:chapterCount},(_,index)=>[
      [`chapter_${index+1}_sourceNumber`,Type.Optional(Type.Integer({minimum:0,maximum:sourceChapterCount,description:`Original chapter to place in final slot ${index+1}. Omit to retain this slot. Use 0 with a writing instruction for a new scene. A source mapping alone copies its prose unchanged.`}))],
      [`chapter_${index+1}_instruction`,Type.Optional(Type.String({minLength:1,description:`Revise only final chapter ${index+1} according to this instruction. Omit when its prose is unchanged.`}))],
    ]).flat()),
  },{additionalProperties:false});
}

export { SourcedReviewToolSchema as ShortReviewToolSchema } from "./review-tool.js";

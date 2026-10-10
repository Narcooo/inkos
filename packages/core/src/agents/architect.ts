import { BaseAgent } from "./base.js";
import type { BookConfig, FanficMode } from "../models/book.js";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { renderHooksProjection } from "../state/state-projections.js";
import { BookRulesSchema, type BookRules } from "../models/book-rules.js";
import { FoundationDetailsToolSchema, FoundationOutlineToolSchema, FoundationCastIndexToolSchema, foundationCastDocumentsToolSchema } from "./architect-tool.js";
import type { HookRecord } from "../models/runtime-state.js";
import { createInitialRuntimeState } from "../state/runtime-state-store.js";
import { commitAtomicFileSet, type AtomicFileWrite } from "../utils/atomic-file-set.js";

// Architect owns the five-section persistence protocol. Foundation craft is
// supplied by the active long-writing and derivative-work Skills.

export interface ArchitectRole {
  readonly tier: "major" | "minor";
  readonly name: string;
  readonly content: string;
}

export interface ArchitectOutput {
  readonly storyFrame: string;
  readonly volumeMap: string;
  readonly roles: ReadonlyArray<ArchitectRole>;
  readonly bookRules: string;
  readonly bookRulesData: BookRules;
  readonly pendingHooks: string;
  readonly initialHooks: ReadonlyArray<HookRecord>;
}

export class ArchitectAgent extends BaseAgent {
  get name(): string {
    return "architect";
  }

  async generateFoundation(
    book: BookConfig,
    externalContext?: string,
    reviewFeedback?: string,
    options?: {
      readonly onOutline?: (outline: { readonly storyFrame: string; readonly volumeMap: string }) => void | Promise<void>;
      reviseFrom?: {
        storyFrame: string;
        volumeMap: string;
        bookRules: string;
        roles: string;
        userFeedback: string;
      };
    },
  ): Promise<ArchitectOutput> {
    const resolvedLanguage = book.language;

    const contextBlock = externalContext
      ? `\n\n## 外部指令\n以下是来自外部系统的创作指令，请将其融入设定中：\n\n${externalContext}\n`
      : "";
    const reviewFeedbackBlock = this.buildReviewFeedbackBlock(reviewFeedback, resolvedLanguage);
    const revisePrompt = options?.reviseFrom
      ? this.buildRevisePrompt(options.reviseFrom)
      : "";

    const systemPrompt = resolvedLanguage === "en"
      ? this.buildEnglishFoundationPrompt(book, contextBlock, reviewFeedbackBlock)
      : this.buildChineseFoundationPrompt(book, contextBlock, reviewFeedbackBlock);

    const langPrefix = resolvedLanguage === "en"
      ? "【LANGUAGE OVERRIDE】All submitted foundation content, character names, place names, and prose must be in English.\n\n"
      : "";
    const userMessage = resolvedLanguage === "en"
      ? `Generate the complete foundation for the ${book.genre} Work titled "${book.title}". Write everything in English.`
      : `请为标题为"${book.title}"的${book.genre}作品生成完整基础设定。`;

    return this.generateFoundationInStages({
      systemPrompt: langPrefix + systemPrompt + revisePrompt,
      userMessage,
      language: resolvedLanguage,

      onOutline: options?.onOutline,
    });
  }

  private buildRevisePrompt(reviseFrom: {
    storyFrame: string;
    volumeMap: string;
    bookRules: string;
    roles: string;
    userFeedback: string;
  }): string {
    return `\n\n## 既有架构稿修订
按已激活 Skill 使用以下权威原稿和用户要求，返回当前五块 foundation 协议。

【story_frame 全文】
${reviseFrom.storyFrame}

【volume_map 全文】
${reviseFrom.volumeMap}

【book_rules 全文】
${reviseFrom.bookRules}

【roles 全文】
${reviseFrom.roles}

用户额外要求：
${reviseFrom.userFeedback || "（无）"}
`;
  }

  // -------------------------------------------------------------------------
  // Foundation artifact protocol. Creative methodology comes from the active
  // long-writing Skill; this code owns only artifact shape and dynamic limits.
  // -------------------------------------------------------------------------
  private buildChineseFoundationPrompt(
    book: BookConfig,
    contextBlock: string,
    reviewFeedbackBlock: string,
  ): string {
    return this.buildFoundationProtocol({ book, contextBlock, reviewFeedbackBlock, language: "zh" });
  }

  private buildEnglishFoundationPrompt(
    book: BookConfig,
    contextBlock: string,
    reviewFeedbackBlock: string,
  ): string {
    return this.buildFoundationProtocol({ book, contextBlock, reviewFeedbackBlock, language: "en" });
  }

  private buildFoundationProtocol(params: {
    readonly book: BookConfig;
    readonly contextBlock: string;
    readonly reviewFeedbackBlock: string;
    readonly language: "zh" | "en";
  }): string {
    const { book, contextBlock, reviewFeedbackBlock, language } = params;
    const metadata = language === "en"
      ? `Platform: ${book.platform}\nGenre: ${book.genre}\nTarget chapters: ${book.targetChapters}\nChapter length: ${book.chapterWordCount}\nTitle: ${book.title}`
      : `平台：${book.platform}\n题材：${book.genre}\n目标章数：${book.targetChapters}\n每章字数：${book.chapterWordCount}\n标题：${book.title}`;
    return language === "en"
      ? `Create the Work foundation using the activated professional Skills and supplied authority.${contextBlock}${reviewFeedbackBlock}\n\n## Work metadata\n${metadata}\n\nSubmit readable foundation artifacts and the small structured rules surface through the required tools.`
      : `按已激活的专业 Skill 和输入权威生成作品基础设定。${contextBlock}${reviewFeedbackBlock}\n\n## 作品元信息\n${metadata}\n\n通过指定工具提交可读基础资产和少量结构化规则。`;
  }
  async writeFoundationFiles(
    bookDir: string,
    output: ArchitectOutput,
    language: "zh" | "en",
    mode: "init" | "revise" = "init",
  ): Promise<void> {
    const writes: AtomicFileWrite[] = [
      { relativePath: join("story", "outline", "story_frame.md"), content: `${output.storyFrame.trim()}\n` },
      { relativePath: join("story", "outline", "volume_map.md"), content: `${output.volumeMap.trim()}\n` },
      { relativePath: join("story", "book_rules.md"), content: `${output.bookRules.trim()}\n` },
      { relativePath: join("story", "book_rules.json"), content: `${JSON.stringify(output.bookRulesData, null, 2)}\n` },
    ];
    for (const role of output.roles) {
      const safeName = role.name.replace(/[/\\:*?"<>|]/g, "_").trim();
      if (!safeName) throw new Error("Foundation role name cannot be represented as a safe file name.");
      writes.push({
        relativePath: join("story", "roles", role.tier === "major" ? "主要角色" : "次要角色", `${safeName}.md`),
        content: `${role.content.trim()}\n`,
      });
    }
    const replacementPaths=new Set(writes.map(write=>write.relativePath));
    const deletes:string[]=[];
    if (mode === "revise") {
      for (const tier of ["主要角色","次要角色"]) {
        const directory=join("story","roles",tier);
        let entries;
        try { entries=await readdir(join(bookDir,directory),{withFileTypes:true}); }
        catch(error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
        for(const entry of entries) {
          const path=join(directory,entry.name);
          if(entry.isFile()&&entry.name.endsWith(".md")&&!replacementPaths.has(path)) deletes.push(path);
        }
      }
    }
    await commitAtomicFileSet({
      rootDir: bookDir,
      writes,
      deletes,
    });
    if (mode === "init") {
      await createInitialRuntimeState({ bookDir, language, hooks: output.initialHooks });
    }
  }
  /**
   * Reverse-engineer foundation from existing chapters.
   */
  async generateFoundationFromImport(
    book: BookConfig,
    chaptersText: string,
    externalContext?: string,
    reviewFeedback?: string,
    options?: { readonly importMode?: "continuation" | "series" },
  ): Promise<ArchitectOutput> {
    const resolvedLanguage = book.language;
    const reviewFeedbackBlock = this.buildReviewFeedbackBlock(reviewFeedback, resolvedLanguage);

    const contextBlock = externalContext
      ? (resolvedLanguage === "en"
          ? `\n\n## External Instructions\n${externalContext}\n`
          : `\n\n## 外部指令\n${externalContext}\n`)
      : "";

    const isSeries = options?.importMode === "series";

    const continuationDirective = resolvedLanguage === "en"
      ? `## Import mode\n${isSeries ? "series" : "continuation"}`
      : `## 导入模式\n${isSeries ? "系列新作" : "原线续写"}`;

    const systemPrompt = this.buildFoundationProtocol({
      book,
      contextBlock,
      reviewFeedbackBlock,
      language: resolvedLanguage,
    }) + (resolvedLanguage === "en"
      ? `\n\n${continuationDirective}\nDerive established facts from the source package. Explicit continuation instructions control future plot and ending. Never infer a mandatory future event from tone or a mystery alone; keep unprescribed futures open. A compressed package is evidence, not permission to invent missing canon. ALL output MUST be written in English.`
      : `\n\n${continuationDirective}\n既成事实从资料包推导；未来剧情和结局服从明确的续写指令。不能仅凭文风或悬念推导必须发生的未来事件，未指定的发展保留开放。压缩资料包是证据，不是臆造缺失正典的许可。`);

    const userMessage = resolvedLanguage === "en"
      ? `Generate the complete foundation for the imported ${book.genre} Work titled "${book.title}". Write everything in English.\n\n${chaptersText}`
      : `以下是《${book.title}》的已有正文资料包，请从中反向推导完整基础设定：\n\n${chaptersText}`;

    return this.generateFoundationInStages({
      systemPrompt,
      userMessage,
      language: resolvedLanguage,

    });
  }

  async generateFanficFoundation(
    book: BookConfig,
    fanficCanon: string,
    fanficMode: FanficMode,
    reviewFeedback?: string,
    options?: {
      readonly onOutline?: (outline: { readonly storyFrame: string; readonly volumeMap: string }) => void | Promise<void>;
    },
  ): Promise<ArchitectOutput> {
    const resolvedLanguage = book.language;
    const reviewFeedbackBlock = this.buildReviewFeedbackBlock(reviewFeedback, resolvedLanguage);

    const canonBlock = resolvedLanguage === "en"
      ? `\n\n## Fanfic mode: ${fanficMode}\n\n## Source canon\n${fanficCanon}`
      : `\n\n## 同人模式：${fanficMode}\n\n## 原作正典\n${fanficCanon}`;
    const systemPrompt = this.buildFoundationProtocol({
      book,
      contextBlock: canonBlock,
      reviewFeedbackBlock,
      language: resolvedLanguage,
    });

    return this.generateFoundationInStages({
      systemPrompt,
      userMessage: `请为标题为"${book.title}"的${fanficMode}模式同人小说生成基础设定。目标${book.targetChapters}章，每章${book.chapterWordCount}字。`,
      language: resolvedLanguage,

      onOutline: options?.onOutline,
    });
  }

  private async generateFoundationInStages(input: {
    readonly systemPrompt: string;
    readonly userMessage: string;
    readonly language: "zh" | "en";
    readonly onOutline?: (outline: { readonly storyFrame: string; readonly volumeMap: string }) => void | Promise<void>;
  }): Promise<ArchitectOutput> {
    const { result: outline } = await this.submitStructured(
      [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.userMessage },
      ],
      {
        name: "submit_foundation_outline",
        label: input.language === "en" ? "Submit foundation outline" : "提交基础框架",
        description: input.language === "en"
          ? "Submit the readable story frame and volume map."
          : "提交可读的故事框架与卷纲。",
        parameters: FoundationOutlineToolSchema,
      },
      { maxTokens: Math.min(8192, this.ctx.client.defaults.maxTokens) },
    );
    await input.onOutline?.({
      storyFrame: outline.storyFrame.trim(),
      volumeMap: outline.volumeMap.trim(),
    });
    const detailsPrompt = input.language === "en"
      ? `${input.userMessage}\n\n<story_frame>\n${outline.storyFrame}\n</story_frame>\n\n<volume_map>\n${outline.volumeMap}\n</volume_map>\n\nComplete the readable book rules, structured rule data, and initial unresolved hooks.`
      : `${input.userMessage}\n\n<story_frame>\n${outline.storyFrame}\n</story_frame>\n\n<volume_map>\n${outline.volumeMap}\n</volume_map>\n\n继续完成可读本书规则、结构化规则数据和初始未解伏笔。`;
    const { result: details } = await this.submitStructured(
      [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: detailsPrompt },
      ],
      {
        name: "submit_foundation_details",
        label: input.language === "en" ? "Submit foundation details" : "提交基础详情",
        description: input.language === "en"
          ? "Submit book rules and initial unresolved hooks. Arrays and objects must be native tool arguments, never JSON strings."
          : "提交本书规则与初始未解伏笔。数组和对象必须是工具参数的原生类型，不要放入字符串。",
        parameters: FoundationDetailsToolSchema,
      },
      {},
    );
    const bookRulesData = BookRulesSchema.parse({ version: "2", ...details.bookRulesData });
    const initialHooks: HookRecord[] = details.pendingHooks.map((hook) => ({
      hookId: hook.hookId.trim(),
      startChapter: 0,
      type: hook.type.trim(),
      status: "deferred",
      lastAdvancedChapter: 0,
      expectedPayoff: hook.expectedPayoff.trim(),
      notes: hook.notes.trim(),
    }));
    const pendingHooks = renderHooksProjection({ hooks: initialHooks }, input.language);

    const castContext=`${input.userMessage}\n\n${outline.storyFrame}\n\n${outline.volumeMap}\n\n${details.bookRules}`;
    const {result:cast} = await this.submitStructured([
      {role:"system",content:input.language==="en"
        ? "List the named people who shape the opening conflict. Submit only their names and major/minor roles. Do not expand unnamed occupational groups into invented biographies."
        : "列出影响开篇冲突的具名人物，只提交姓名和主要/次要角色级别，不把无名岗位群体扩写成虚构人物。"},
      {role:"user",content:JSON.stringify({storyFrame:outline.storyFrame,volumeMap:outline.volumeMap,bookRules:details.bookRules})},
    ],{name:"submit_foundation_cast_index",label:"Identify opening cast",description:"Submit the names and tiers of the opening cast.",parameters:FoundationCastIndexToolSchema},
    {maxTokens:Math.min(2048,this.ctx.client.defaults.maxTokens),professionalGuidance:false});
    const {result:cards} = await this.submitStructured([
      {role:"system",content:input.language==="en"
        ? "Create concise character cards for the named people who shape the opening conflict. Ground each card in the supplied story. Give present motive, knowledge, relationship pressure and limits in about 80–120 words; avoid repeating the plot or expanding unnamed occupational groups into full biographies."
        : "为影响开篇冲突的具名人物写简明角色卡。每人约150—250字，写清当下动机、已知信息、关系压力与能力边界，依据已给定故事，不重复整篇情节，不把无名岗位群体扩写成完整传记。"},
      {role:"user",content:castContext},
    ],{name:"submit_foundation_cast_documents",label:"Submit opening character cards",description:"Submit each character card as text in its named field.",parameters:foundationCastDocumentsToolSchema(cast.roles)},
    {maxTokens:Math.min(8192,this.ctx.client.defaults.maxTokens)});
    const roles: ArchitectRole[] = cast.roles.map((role,index)=>({tier:role.tier,name:role.name.trim(),content:cards[`role_${index+1}_content`]!.trim()}));

    return {
      storyFrame: outline.storyFrame.trim(),
      volumeMap: outline.volumeMap.trim(),
      roles,
      bookRules: details.bookRules.trim(),
      bookRulesData,
      pendingHooks,
      initialHooks,
    };
  }
  private buildReviewFeedbackBlock(
    reviewFeedback: string | undefined,
    language: "zh" | "en",
  ): string {
    const trimmed = reviewFeedback?.trim();
    if (!trimmed) return "";

    if (language === "en") {
      return `\n\n## Previous Review Feedback
Apply the following requested changes to the foundation instead of paraphrasing the same design:

${trimmed}\n`;
    }

    return `\n\n## 上一轮审核反馈
按以下要求修改基础设定，不能只换措辞重写同一套方案：

${trimmed}\n`;
  }

}

/**
 * AI 味去除功能使用示例
 * 
 * 这个 Agent 可以独立调用，用于：
 * 1. 单独处理已有文本
 * 2. 作为写作 pipeline 的后处理步骤
 * 3. 在用户请求时实时调用
 */

import { AITasteRemoverAgent } from "./ai-taste-remover.js";

// 示例 1: 基本用法
async function example1() {
  const agent = new AITasteRemoverAgent(ctx);
  
  const input = `随着科技的不断发展，AI 技术已经深入到我们生活的方方面面。
  值得一提的是，这项技术不仅提高了效率，更重要的是为人们带来了便利。
  不可否认，未来 AI 将在更多领域发挥重要作用，谱写新的篇章。`;

  const result = await agent.removeAITaste({
    content: input,
    targetStyle: "conservative", // 保守策略
  });

  console.log("门检结果:", result.gateCheckResult);
  console.log("检测语体:", result.registerDetected);
  console.log("修改后:", result.revisedContent);
  console.log("发现模式:", result.patternsFound);
  console.log("打磨报告:", result.polishReport);
}

// 示例 2: 指定语体
async function example2() {
  const agent = new AITasteRemoverAgent(ctx);
  
  const input = `本产品赋能企业数字化转型，提供全方位解决方案。
  通过打造闭环生态，助力客户实现业务增长。`;

  const result = await agent.removeAITaste({
    content: input,
    register: "business", // 指定商务语体
    targetStyle: "aggressive", // 激进策略
  });

  console.log("商务文案去 AI 味:", result.revisedContent);
}

// 示例 3: 真人文本检测
async function example3() {
  const agent = new AITasteRemoverAgent(ctx);
  
  const input = `我忘了她用的是哪个词，反正我觉得不对，说不上来为什么。
  那年我二十三，穷得一塌糊涂。`;

  const result = await agent.removeAITaste({
    content: input,
  });

  if (result.gateCheckResult.type === "human") {
    console.log("检测到真人文本，不做修改");
    console.log("证据:", result.gateCheckResult.evidence);
  }
}

// 示例 4: 集成到写作流程
async function example4_inPipeline() {
  // 在章节生成后自动调用
  const writerOutput = await writer.writeChapter(...);
  
  const aiTasteRemover = new AITasteRemoverAgent(ctx);
  const humanizedResult = await aiTasteRemover.removeAITaste({
    content: writerOutput.content,
    targetStyle: "conservative",
    register: "written", // 书面语体
  });

  // 使用去 AI 味后的版本
  return humanizedResult.revisedContent;
}

// 示例 5: 批量处理
async function example5_batch() {
  const agent = new AITasteRemoverAgent(ctx);
  const chapters = ["第 1 章内容", "第 2 章内容", "第 3 章内容"];

  const results = await Promise.all(
    chapters.map(content => 
      agent.removeAITaste({
        content,
        targetStyle: "conservative",
      })
    )
  );

  return results.map(r => r.revisedContent);
}

// 示例 6: 语体对比
async function example6_registerComparison() {
  const agent = new AITasteRemoverAgent(ctx);
  const input = `这个功能很重要，具有里程碑意义。`;

  // 不同语体下的处理结果会不同
  const results = {
    social: await agent.removeAITaste({ content: input, register: "social" }),
    business: await agent.removeAITaste({ content: input, register: "business" }),
    academic: await agent.removeAITaste({ content: input, register: "academic" }),
  };

  console.log("社交语体:", results.social.revisedContent);
  console.log("商务语体:", results.business.revisedContent);
  console.log("学术语体:", results.academic.revisedContent);
}

// 核心 API 说明
interface RemoveAITasteInput {
  content: string;                    // 待处理的文本
  targetStyle?: "conservative" | "aggressive";  // 保守/激进策略
  register?: RegisterType;            // 语体类型（可选，会自动检测）
  language?: "zh" | "en";             // 语言（目前只支持中文）
  temperature?: number;               // LLM 温度（默认 0.3）
}

interface RemoveAITasteOutput {
  revisedContent: string;             // 修改后的文本
  gateCheckResult: GateCheckResult;   // 门检结果（真人/AI/不确定）
  registerDetected: RegisterType;     // 检测到的语体
  patternsFound: AIPattern[];         // 发现的 AI 腔模式
  polishReport: PolishReport;         // 打磨报告
  tokenUsage?: TokenUsage;            // Token 使用统计
}

// 支持的语体类型
type RegisterType = 
  | "social"      // 社交/口语
  | "content"     // 内容/自媒体
  | "business"    // 商务/职场
  | "written"     // 书面/一般
  | "narrative"   // 叙事非虚构/特稿
  | "brand"       // 品牌广告/文案
  | "academic"    // 学术/科技
  | "legal"       // 公文/法律
  | "exam";       // 高考/应试作文

export { example1, example2, example3, example4_inPipeline, example5_batch };

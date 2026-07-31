import type { InkosEndpoint } from "./types.js";
import { ANTHROPIC } from "./endpoints/anthropic.js";
import { OPENAI } from "./endpoints/openai.js";
import { OPENAI_CODEX } from "./endpoints/openaiCodex.js";
import { GOOGLE } from "./endpoints/google.js";
import { DEEPSEEK } from "./endpoints/deepseek.js";
import { MINIMAX } from "./endpoints/minimax.js";
// B1
import { MOONSHOT } from "./endpoints/moonshot.js";
import { ZHIPU } from "./endpoints/zhipu.js";
import { SILICONCLOUD } from "./endpoints/siliconcloud.js";
import { BAILIAN } from "./endpoints/bailian.js";
import { VOLCENGINE } from "./endpoints/volcengine.js";
import { HUNYUAN } from "./endpoints/hunyuan.js";
import { BAICHUAN } from "./endpoints/baichuan.js";
import { STEPFUN } from "./endpoints/stepfun.js";
import { WENXIN } from "./endpoints/wenxin.js";
// B2
import { SPARK } from "./endpoints/spark.js";
import { SENSENOVA } from "./endpoints/sensenova.js";
import { TENCENTCLOUD } from "./endpoints/tencentcloud.js";
import { XIAOMI_MIMO } from "./endpoints/xiaomimimo.js";
import { LONGCAT } from "./endpoints/longcat.js";
import { INTERNLM } from "./endpoints/internlm.js";
import { ZEROONE } from "./endpoints/zeroone.js";
import { AI360 } from "./endpoints/ai360.js";
// B4
import { OLLAMA } from "./endpoints/ollama.js";
import { OPENROUTER } from "./endpoints/openrouter.js";
import { CUSTOM } from "./endpoints/custom.js";
import { MISTRAL } from "./endpoints/mistral.js";
import { XAI } from "./endpoints/xai.js";
import { NEWAPI } from "./endpoints/newapi.js";
import { GITHUB_COPILOT } from "./endpoints/githubCopilot.js";
import { KKAIAPI } from "./endpoints/kkaiapi.js";
// B6 CodingPlan
import { KIMI_CODING_PLAN } from "./endpoints/kimiCodingPlan.js";
import { KIMI_CODE } from "./endpoints/kimiCode.js";
import { MINIMAX_CODING_PLAN } from "./endpoints/minimaxCodingPlan.js";
import { BAILIAN_CODING_PLAN } from "./endpoints/bailianCodingPlan.js";
import { GLM_CODING_PLAN } from "./endpoints/glmCodingPlan.js";
import { VOLCENGINE_CODING_PLAN } from "./endpoints/volcengineCodingPlan.js";
import { OPENCODE_CODING_PLAN } from "./endpoints/opencodeCodingPlan.js";
import { ASTRON_CODING_PLAN } from "./endpoints/astronCodingPlan.js";

export type { InkosEndpoint, InkosModel, ApiProtocol, EndpointGroup } from "./types.js";

/**
 * 所有已注册 provider 的扁平列表。顺序定义了 lookup Layer 2 的遍历顺序，
 * 但 Layer 2 还会按 PROVIDER_PRIORITY 显式排序，所以此处顺序不影响结果。
 */
const ALL_PROVIDERS: readonly InkosEndpoint[] = [
  ANTHROPIC, OPENAI, OPENAI_CODEX, GOOGLE, DEEPSEEK, MINIMAX,
  MOONSHOT, ZHIPU, SILICONCLOUD, BAILIAN, VOLCENGINE, HUNYUAN, BAICHUAN, STEPFUN, WENXIN,
  SPARK, SENSENOVA, TENCENTCLOUD, XIAOMI_MIMO, LONGCAT, INTERNLM,
  ZEROONE, AI360,
  OLLAMA, OPENROUTER, CUSTOM, MISTRAL, XAI, NEWAPI, GITHUB_COPILOT, KKAIAPI,
  // B6 CodingPlan（8 个）
  KIMI_CODING_PLAN, KIMI_CODE, MINIMAX_CODING_PLAN, BAILIAN_CODING_PLAN, GLM_CODING_PLAN, VOLCENGINE_CODING_PLAN, OPENCODE_CODING_PLAN, ASTRON_CODING_PLAN,
];

const PROVIDERS_BY_ID: Map<string, InkosEndpoint> = new Map(
  ALL_PROVIDERS.map((p) => [p.id, p]),
);

export function getAllEndpoints(): readonly InkosEndpoint[] {
  return ALL_PROVIDERS;
}

export function getEndpoint(id: string): InkosEndpoint | undefined {
  return PROVIDERS_BY_ID.get(id);
}

/**
 * inkos 自维护的 provider 定义。每个 provider 一个 .ts 文件，
 * 里面一个 InkosEndpoint 对象（provider 元数据 + models 数组）。
 *
 * 数据冷启动自 lobe-chat/packages/model-bank，之后由 inkos 自管。
 * 新模型发布 / 参数调整时手动加 card，不做持续 sync。
 */

export type ApiProtocol =
  | "openai-completions"
  | "openai-responses"
  | "openai-codex-responses"
  | "anthropic-messages"
  | "google-generative-ai";

export type EndpointGroup =
  | "overseas"
  | "china"
  | "aggregator"
  | "local"
  | "codingPlan";

export interface InkosModel {
  /** API 请求体里实际用的 model id（可能带斜线如 'deepseek/deepseek-v3'）。UI 也直接用 id 显示 */
  readonly id: string;
  /** 模型输出上限 tokens */
  readonly maxOutput: number;
  /** 上下文窗口总 tokens */
  readonly contextWindowTokens: number;
  /** 默认 true。false 表示 lobe 标记此模型不可用 */
  readonly enabled?: boolean;
  /** CodingPlan 专用：API 调用时用这个代替 id 作为 model 字段 */
  readonly deploymentName?: string;
  /** 发布日期 ISO 字符串，可选（用于 UI 的"新模型"徽章） */
  readonly releasedAt?: string;
  /**
   * API 硬要求的 temperature 值（例：Moonshot kimi-k2.5/k2.6 强制 1，违反直接 400）。
   * 有值时 provider 层会 clamp 所有 per-call 温度到该值——这是服务端约束，
   * 不是"推荐值"。普通模型不要设这个字段。
   */
  readonly temperature?: number;
  /** 生命周期状态；enabled=false 仍保留为兼容旧数据的硬下线标记。 */
  readonly status?: "active" | "deprecated" | "disabled" | "nonText";
  readonly replacement?: string;
  readonly capabilities?: {
    readonly text?: boolean;
    readonly imageInput?: boolean;
    readonly imageOutput?: boolean;
    readonly tools?: boolean;
    readonly reasoning?: boolean;
  };
}

export interface ProviderCompat {
  /** OpenAI Responses store 参数是否被兼容层接受；Google Gemini OpenAI-compatible 不接受。 */
  readonly supportsStore?: boolean;
  readonly supportsSystemRole?: boolean;
  readonly supportsDeveloperRole?: boolean;
  /** Some OpenAI-compatible providers reject restored histories ending in toolResult; only those providers get a synthetic assistant bridge during context projection. */
  readonly requiresAssistantAfterToolResult?: boolean;
}

export interface ProviderTransportDefaults {
  readonly apiFormat?: "chat" | "responses";
  readonly stream?: boolean;
}

export interface InkosEndpoint {
  readonly id: string;
  readonly label: string;
  /** UI 分组。custom 不参与分组，其他 endpoint 必填。 */
  readonly group?: EndpointGroup;

  readonly api: ApiProtocol;
  readonly baseUrl: string;
  /** /models 接口的 baseUrl 跟主 baseUrl path 不同时（如百炼 dashscope） */
  readonly modelsBaseUrl?: string;

  /** apikey 两步验证时发 chat hello 用的模型 id */
  readonly checkModel?: string;

  readonly temperatureRange?: readonly [number, number];
  readonly defaultTemperature?: number;
  readonly writingTemperature?: number;
  readonly temperatureHint?: string;
  readonly compat?: ProviderCompat;
  readonly transportDefaults?: ProviderTransportDefaults;

  readonly models: readonly InkosModel[];
}

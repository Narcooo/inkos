import { z } from "zod";
import { LLM_API_FORMATS } from "../llm/api-format.js";

export const LLMServiceEntrySchema = z.object({
  service: z.string().min(1),
  name: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  models: z.array(z.string().min(1)).optional(),
  temperature: z.number().min(0).max(2).optional(),
  apiFormat: z.enum(LLM_API_FORMATS).optional(),
  stream: z.boolean().optional(),
}).strict();

const LLMCoverConfigSchema = z.object({
  service: z.enum(["kkaiapi", "openai", "google", "minimax"]),
  model: z.string().min(1),
  baseUrl: z.string().url().optional(),
}).strict().optional();

export const LLMConfigSchema = z.object({
  provider: z.enum(["anthropic", "openai", "custom"]),
  service: z.string().default("custom"),
  configSource: z.enum(["env", "studio"]).default("env"),
  baseUrl: z.string().url(),
  apiKey: z.string().default(""),
  model: z.string().min(1),
  proxyUrl: z.string().url().optional(),
  temperature: z.number().min(0).max(2).default(0.7),
  thinkingBudget: z.number().int().min(0).default(0),
  extra: z.record(z.unknown()).optional(),
  headers: z.record(z.string()).optional(),
  apiFormat: z.enum(LLM_API_FORMATS).default("chat"),
  stream: z.boolean().default(true),
  services: z.array(LLMServiceEntrySchema).optional(),
  defaultModel: z.string().min(1).optional(),
  cover: LLMCoverConfigSchema,
}).strict();

export type LLMConfig = z.infer<typeof LLMConfigSchema>;

export const NotifyChannelSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("telegram"),
    botToken: z.string().min(1),
    chatId: z.string().min(1),
    format: z.enum(["markdown", "text"]).default("markdown"),
  }).strict(),
  z.object({
    type: z.literal("wechat-work"),
    webhookUrl: z.string().url(),
    format: z.enum(["markdown", "text"]).default("markdown"),
  }).strict(),
  z.object({
    type: z.literal("feishu"),
    webhookUrl: z.string().url(),
    format: z.enum(["markdown", "text"]).default("markdown"),
  }).strict(),
  z.object({
    type: z.literal("webhook"),
    url: z.string().url(),
    secret: z.string().optional(),
    events: z.array(z.string()).default([]),
    format: z.enum(["markdown", "text"]).default("markdown"),
  }).strict(),
]);

export type NotifyChannel = z.infer<typeof NotifyChannelSchema>;

export const DetectionConfigSchema = z.object({
  provider: z.enum(["gptzero", "originality", "custom"]).default("custom"),
  apiUrl: z.string().url(),
  apiKeyEnv: z.string().min(1),
  enabled: z.boolean().default(false),
}).strict();

export type DetectionConfig = z.infer<typeof DetectionConfigSchema>;

export const AgentLLMOverrideSchema = z.object({
  model: z.string().min(1),
  provider: z.enum(["anthropic", "openai", "custom"]).optional(),
  baseUrl: z.string().url().optional(),
  apiKeyEnv: z.string().optional(),
  stream: z.boolean().optional(),
}).strict();

export type AgentLLMOverride = z.infer<typeof AgentLLMOverrideSchema>;

const ModelOverrideValueSchema = z.union([z.string(), AgentLLMOverrideSchema]);

export const ResearchSearchConfigSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.enum(["tavily", "custom"]).default("tavily"),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  apiKeyEnv: z.string().optional(),
}).strict().default({
  enabled: false,
  provider: "tavily",
});

export type ResearchSearchConfig = z.infer<typeof ResearchSearchConfigSchema>;

export const ProjectConfigSchema = z.object({
  name: z.string().min(1),
  version: z.literal("0.1.0"),
  language: z.enum(["zh", "en"]).default("zh"),
  llm: LLMConfigSchema,
  notify: z.array(NotifyChannelSchema).default([]),
  detection: DetectionConfigSchema.optional(),
  researchSearch: ResearchSearchConfigSchema,
  modelOverrides: z.record(z.string(), ModelOverrideValueSchema).optional(),
  daemon: z.object({
    schedule: z.object({
      radarCron: z.string().default("0 */6 * * *"),
      writeCron: z.string().default("*/15 * * * *"),
    }).strict(),
    maxConcurrentBooks: z.number().int().min(1).default(3),
    chaptersPerCycle: z.number().int().min(1).default(1),
    retryDelayMs: z.number().int().min(0).default(30_000),
    cooldownAfterChapterMs: z.number().int().min(0).default(10_000),
    maxChaptersPerDay: z.number().int().min(1).default(50),
  }).strict().default({
    schedule: {
      radarCron: "0 */6 * * *",
      writeCron: "*/15 * * * *",
    },
    maxConcurrentBooks: 3,
    chaptersPerCycle: 1,
    retryDelayMs: 30_000,
    cooldownAfterChapterMs: 10_000,
    maxChaptersPerDay: 50,
  }),
}).strict();

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

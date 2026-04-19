import { z } from "zod";

const LLMServiceEntrySchema = z.object({
  service: z.string().min(1),
  name: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).optional(),
  apiFormat: z.enum(["chat", "responses"]).optional(),
  stream: z.boolean().optional(),
});

export const LLMConfigSchema = z.object({
  provider: z.enum(["anthropic", "openai", "custom"]),
  service: z.string().default("custom"),
  configSource: z.enum(["env", "studio"]).default("env"),
  baseUrl: z.string().url(),
  apiKey: z.string().default(""),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().min(1).default(8192),
  thinkingBudget: z.number().int().min(0).default(0),
  extra: z.record(z.unknown()).optional(),
  headers: z.record(z.string()).optional(),
  apiFormat: z.enum(["chat", "responses"]).default("chat"),
  stream: z.boolean().default(true),
  services: z.array(LLMServiceEntrySchema).optional(),
  defaultModel: z.string().min(1).optional(),
});

export type LLMConfig = z.infer<typeof LLMConfigSchema>;

export const NotifyChannelSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("telegram"),
    botToken: z.string().min(1),
    chatId: z.string().min(1),
  }),
  z.object({
    type: z.literal("wechat-work"),
    webhookUrl: z.string().url(),
  }),
  z.object({
    type: z.literal("feishu"),
    webhookUrl: z.string().url(),
  }),
  z.object({
    type: z.literal("webhook"),
    url: z.string().url(),
    secret: z.string().optional(),
    events: z.array(z.string()).default([]),
  }),
]);

export type NotifyChannel = z.infer<typeof NotifyChannelSchema>;

export const DetectionConfigSchema = z.object({
  provider: z.enum(["gptzero", "originality", "custom"]).default("custom"),
  apiUrl: z.string().url(),
  apiKeyEnv: z.string().min(1),
  threshold: z.number().min(0).max(1).default(0.5),
  enabled: z.boolean().default(false),
  autoRewrite: z.boolean().default(false),
  maxRetries: z.number().int().min(1).max(10).default(3),
});

export type DetectionConfig = z.infer<typeof DetectionConfigSchema>;

export const QualityGatesSchema = z.object({
  maxAuditRetries: z.number().int().min(0).max(10).default(2),
  pauseAfterConsecutiveFailures: z.number().int().min(1).default(3),
  retryTemperatureStep: z.number().min(0).max(0.5).default(0.1),
});

export type QualityGates = z.infer<typeof QualityGatesSchema>;

export const AgentLLMOverrideSchema = z.object({
  model: z.string().min(1),
  provider: z.enum(["anthropic", "openai", "custom"]).optional(),
  baseUrl: z.string().url().optional(),
  apiKeyEnv: z.string().optional(),
  stream: z.boolean().optional(),
});

export type AgentLLMOverride = z.infer<typeof AgentLLMOverrideSchema>;

export const InputGovernanceModeSchema = z.enum(["legacy", "v2"]);
export type InputGovernanceMode = z.infer<typeof InputGovernanceModeSchema>;

const ModelOverrideValueSchema = z.union([z.string(), AgentLLMOverrideSchema]);

export const ProjectConfigSchema = z.object({
  name: z.string().min(1),
  version: z.literal("0.1.0"),
  language: z.enum(["zh", "en"]).default("zh"),
  llm: LLMConfigSchema,
  notify: z.array(NotifyChannelSchema).default([]),
  detection: DetectionConfigSchema.optional(),
  modelOverrides: z.record(z.string(), ModelOverrideValueSchema).optional(),
  inputGovernanceMode: InputGovernanceModeSchema.default("v2"),
  daemon: z.object({
    schedule: z.object({
      radarCron: z.string().default("0 */6 * * *"),
      writeCron: z.string().default("*/15 * * * *"),
    }),
    maxConcurrentBooks: z.number().int().min(1).default(3),
    chaptersPerCycle: z.number().int().min(1).max(20).default(1),
    retryDelayMs: z.number().int().min(0).default(30_000),
    cooldownAfterChapterMs: z.number().int().min(0).default(10_000),
    maxChaptersPerDay: z.number().int().min(1).default(50),
    qualityGates: QualityGatesSchema.default({
      maxAuditRetries: 2,
      pauseAfterConsecutiveFailures: 3,
      retryTemperatureStep: 0.1,
    }),
  }).default({
    schedule: {
      radarCron: "0 */6 * * *",
      writeCron: "*/15 * * * *",
    },
    maxConcurrentBooks: 3,
    chaptersPerCycle: 1,
    retryDelayMs: 30_000,
    cooldownAfterChapterMs: 10_000,
    maxChaptersPerDay: 50,
    qualityGates: {
      maxAuditRetries: 2,
      pauseAfterConsecutiveFailures: 3,
      retryTemperatureStep: 0.1,
    },
  }),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

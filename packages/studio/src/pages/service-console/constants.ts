import type { ServiceDetailConnectionStatus } from "../service-detail-state";
import type { RouteRow } from "./types";

export const SERVICE_PRIORITY = [
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "moonshot",
  "custom",
] as const;

export const PRESET_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
  deepseek: "https://api.deepseek.com",
  moonshot: "https://api.moonshot.cn/v1",
  minimax: "https://api.minimaxi.com/anthropic",
  bailian: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  ollama: "http://localhost:11434/v1",
};

export const DEFAULT_ROUTES: RouteRow[] = [
  { id: "ideation", task: "构思与灵感", primary: "OpenAI / gpt-4o", fallback: "Anthropic / claude-3-opus", timeout: "60s", retry: "2", enabled: true },
  { id: "outline", task: "大纲与结构", primary: "Kimi / moonshot-v1-128k", fallback: "OpenAI / gpt-4o-mini", timeout: "45s", retry: "2", enabled: true },
  { id: "draft", task: "内容创作", primary: "OpenAI / gpt-4o", fallback: "Anthropic / claude-3-sonnet", timeout: "60s", retry: "2", enabled: true },
  { id: "polish", task: "润色与编辑", primary: "Anthropic / claude-3-opus", fallback: "Gemini / gemini-1.5-pro", timeout: "60s", retry: "2", enabled: true },
  { id: "summary", task: "摘要与提炼", primary: "Gemini / gemini-1.5-flash", fallback: "DeepSeek / deepseek-chat", timeout: "30s", retry: "1", enabled: true },
  { id: "copy", task: "标题与文案", primary: "DeepSeek / deepseek-chat", fallback: "Kimi / moonshot-v1-32k", timeout: "30s", retry: "1", enabled: true },
];

export const STATUS_COPY: Record<ServiceDetailConnectionStatus["state"], string> = {
  idle: "待检测",
  testing: "检测中",
  connected: "已连接",
  error: "连接失败",
  saving: "保存中",
  saved: "已保存",
};

import { Buffer } from "node:buffer";
import { extractOpenAICodexAccountId } from "./openai-codex-auth.js";

export const OPENAI_CODEX_IMAGE_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
export const OPENAI_CODEX_IMAGE_MODEL = "gpt-image-2";
export const OPENAI_CODEX_IMAGE_HOST_MODELS = ["gpt-5.6-sol", "gpt-5.5", "gpt-5.4"] as const;

const MAX_RESPONSE_BYTES = 80 * 1024 * 1024;
const MAX_ERROR_CHARS = 500;

export interface OpenAICodexImageRequest {
  readonly accessToken: string;
  readonly prompt: string;
  readonly size: string;
  readonly quality?: "low" | "medium" | "high";
  readonly signal?: AbortSignal;
  readonly fetchImpl?: typeof fetch;
}

class OpenAICodexImageHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "OpenAICodexImageHttpError";
  }
}

export async function generateOpenAICodexImage(
  request: OpenAICodexImageRequest,
): Promise<{ readonly buffer: Buffer; readonly extension: "png" }> {
  const accountId = extractOpenAICodexAccountId(request.accessToken);
  if (!accountId) throw new Error("OpenAI Codex access token does not contain a ChatGPT account ID.");

  let lastError: unknown;
  for (const hostModel of OPENAI_CODEX_IMAGE_HOST_MODELS) {
    try {
      return await requestOpenAICodexImage(request, accountId, hostModel);
    } catch (error) {
      lastError = error;
      if (!(error instanceof OpenAICodexImageHttpError) || !isUnsupportedHostModel(error)) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("OpenAI Codex image generation failed.");
}

async function requestOpenAICodexImage(
  request: OpenAICodexImageRequest,
  accountId: string,
  hostModel: string,
): Promise<{ readonly buffer: Buffer; readonly extension: "png" }> {
  const timeoutSignal = AbortSignal.timeout(180_000);
  const signal = request.signal ? AbortSignal.any([request.signal, timeoutSignal]) : timeoutSignal;
  const response = await (request.fetchImpl ?? fetch)(OPENAI_CODEX_IMAGE_RESPONSES_URL, {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      Authorization: `Bearer ${request.accessToken}`,
      "ChatGPT-Account-Id": accountId,
      "Content-Type": "application/json",
      "OpenAI-Beta": "responses=experimental",
      originator: "inkos",
    },
    body: JSON.stringify({
      model: hostModel,
      store: false,
      stream: true,
      instructions: "You are an image generation assistant. Use the image_generation tool to fulfill the request.",
      input: [{
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: request.prompt }],
      }],
      tools: [{
        type: "image_generation",
        model: OPENAI_CODEX_IMAGE_MODEL,
        size: normalizeOpenAICodexImageSize(request.size),
        quality: request.quality ?? "medium",
        output_format: "png",
        background: "opaque",
      }],
    }),
    signal,
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, MAX_ERROR_CHARS);
    throw new OpenAICodexImageHttpError(
      response.status,
      `OpenAI Codex image generation failed: HTTP ${response.status}${body ? ` ${summarizeError(body)}` : ""}`,
    );
  }

  const imageBase64 = await extractImageFromSse(response);
  if (!imageBase64) {
    throw new Error("OpenAI Codex response did not include an image_generation_call result.");
  }
  return { buffer: Buffer.from(imageBase64, "base64"), extension: "png" };
}

function normalizeOpenAICodexImageSize(size: string): "1024x1024" | "1024x1536" | "1536x1024" {
  if (size === "1024x1536" || size === "1536x1024" || size === "1024x1024") return size;
  const match = /^(\d+)x(\d+)$/u.exec(size.trim());
  if (!match) return "1024x1024";
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (height > width) return "1024x1536";
  if (width > height) return "1536x1024";
  return "1024x1024";
}

function isUnsupportedHostModel(error: OpenAICodexImageHttpError): boolean {
  return error.status === 400 && /model.+(?:not supported|unsupported|does not exist|not found)/iu.test(error.message);
}

function summarizeError(body: string): string {
  try {
    const payload = JSON.parse(body) as { error?: { message?: unknown } };
    const message = payload.error?.message;
    return typeof message === "string" && message.trim() ? message.trim() : body;
  } catch {
    return body;
  }
}

async function extractImageFromSse(response: Response): Promise<string | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let totalBytes = 0;
  let latestImage: string | null = null;

  const consumeBlock = (block: string): void => {
    const data = block.split(/\r?\n/u)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") return;
    try {
      const found = findImageBase64(JSON.parse(data));
      if (found) latestImage = found;
    } catch {
      // Ignore non-JSON keepalives and continue parsing subsequent events.
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("OpenAI Codex image response exceeded the 80 MB safety limit.");
    }
    buffered += decoder.decode(value, { stream: true });
    let boundary = findSseBoundary(buffered);
    while (boundary) {
      consumeBlock(buffered.slice(0, boundary.index));
      buffered = buffered.slice(boundary.index + boundary.length);
      boundary = findSseBoundary(buffered);
    }
  }
  buffered += decoder.decode();
  if (buffered.trim()) consumeBlock(buffered);
  return latestImage;
}

function findSseBoundary(value: string): { readonly index: number; readonly length: number } | null {
  const match = /\r?\n\r?\n/u.exec(value);
  return match ? { index: match.index, length: match[0].length } : null;
}

function findImageBase64(value: unknown): string | null {
  if (Array.isArray(value)) {
    let found: string | null = null;
    for (const item of value) found = findImageBase64(item) ?? found;
    return found;
  }
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  let found: string | null = null;
  if (item.type === "image_generation_call" && typeof item.result === "string" && item.result) {
    found = item.result;
  }
  if (typeof item.partial_image_b64 === "string" && item.partial_image_b64) {
    found = item.partial_image_b64;
  }
  for (const child of Object.values(item)) found = findImageBase64(child) ?? found;
  return found;
}

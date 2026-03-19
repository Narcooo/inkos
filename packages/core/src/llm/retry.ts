// Utilidad de reintento con retroceso exponencial para llamadas LLM
// Reintenta errores transitorios de red/API (429, 502, 503, ECONNRESET, etc.)
// sin reintentar errores del cliente (401, 403, 400) que no se resolverán con reintentos.

import type { Logger } from "../utils/logger.js";

export interface RetryOptions {
  /** Número máximo de reintentos (por defecto: 3) */
  readonly maxRetries?: number;
  /** Retardo base en milisegundos (por defecto: 1000) */
  readonly baseDelayMs?: number;
  /** Retardo máximo en milisegundos (por defecto: 30000) */
  readonly maxDelayMs?: number;
  /** Función personalizada para determinar si un error es reintentable */
  readonly retryableCheck?: (error: unknown) => boolean;
  /** Función de retardo inyectable para testing (por defecto: setTimeout) */
  readonly delayFn?: (ms: number) => Promise<void>;
  /** Logger opcional — si se provee, los mensajes de reintento se envían al logger en vez de stderr */
  readonly logger?: Logger;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30000;

/**
 * Patrones de error que indican fallos transitorios del servidor/red
 * y que se pueden resolver reintentando.
 */
const RETRYABLE_PATTERNS = [
  "429",
  "502",
  "503",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "socket hang up",
  "network",
  "fetch failed",
  "请求过多",            // Mensaje traducido de wrapLLMError para 429
] as const;

/**
 * Patrones de error que indican problemas del cliente
 * y que NO se resolverán reintentando.
 */
const NON_RETRYABLE_PATTERNS = [
  "401",
  "403",
  "400",
  "invalid_api_key",
  "未授权",              // Mensaje traducido de wrapLLMError para 401
  "请求被拒绝",          // Mensaje traducido de wrapLLMError para 403
] as const;

/** Verifica si un error es reintentable según los patrones conocidos. */
export function isRetryableError(error: unknown): boolean {
  const msg = String(error);

  // Los errores del cliente nunca son reintentables
  for (const pattern of NON_RETRYABLE_PATTERNS) {
    if (msg.includes(pattern)) return false;
  }

  // Los errores transitorios son reintentables
  for (const pattern of RETRYABLE_PATTERNS) {
    if (msg.includes(pattern)) return true;
  }

  // Los errores genéricos de red/sistema también son reintentables
  if (error instanceof TypeError && msg.includes("fetch")) return true;

  return false;
}

/** Calcula el retardo con retroceso exponencial + jitter aleatorio. */
export function computeBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
  // Jitter: entre 50% y 100% del retardo calculado para evitar thundering herd
  const jitter = 0.5 + Math.random() * 0.5;
  return Math.round(cappedDelay * jitter);
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Envuelve una función asíncrona con lógica de reintento con retroceso exponencial.
 *
 * - Errores transitorios (429, 502, 503, ECONNRESET, etc.) → reintenta con backoff
 * - Errores del cliente (401, 403, 400) → falla inmediatamente sin reintentar
 * - Después de agotar los reintentos → lanza el último error
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const checkRetryable = options?.retryableCheck ?? isRetryableError;
  const delay = options?.delayFn ?? defaultDelay;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // No reintentar si ya agotamos los intentos
      if (attempt >= maxRetries) break;

      // No reintentar errores del cliente
      if (!checkRetryable(error)) break;

      const delayMs = computeBackoffDelay(attempt, baseDelayMs, maxDelayMs);
      const retryMsg = `Attempt ${attempt + 1}/${maxRetries} failed, retrying in ${delayMs}ms: ${String(error).slice(0, 120)}`;
      if (options?.logger) {
        options.logger.warn(retryMsg, { attempt: attempt + 1, maxRetries, delayMs });
      } else {
        process.stderr.write(`[llm-retry] ${retryMsg}\n`);
      }
      await delay(delayMs);
    }
  }

  throw lastError;
}

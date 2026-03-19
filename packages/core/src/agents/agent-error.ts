/**
 * AgentError — Error estructurado que lleva contexto del agente.
 *
 * Permite a los consumidores (runner, scheduler, CLI) identificar
 * qué agente falló, en qué operación, y tomar decisiones de recuperación.
 */

export class AgentError extends Error {
  /** Nombre del agente que lanzó el error (e.g. "writer", "auditor", "reviser"). */
  readonly agent: string;
  /** ID del libro que se estaba procesando. */
  readonly bookId?: string;
  /** Número de capítulo involucrado. */
  readonly chapterNumber?: number;
  /** Si el error es potencialmente reintentable. */
  readonly retryable: boolean;
  /** Error original subyacente. */
  readonly cause: unknown;

  constructor(options: {
    readonly agent: string;
    readonly message: string;
    readonly cause: unknown;
    readonly bookId?: string;
    readonly chapterNumber?: number;
    readonly retryable?: boolean;
  }) {
    const prefix = `[${options.agent}]`;
    const bookCtx = options.bookId ? ` book="${options.bookId}"` : "";
    const chCtx = options.chapterNumber ? ` ch=${options.chapterNumber}` : "";
    super(`${prefix}${bookCtx}${chCtx} ${options.message}`);
    this.name = "AgentError";
    this.agent = options.agent;
    this.bookId = options.bookId;
    this.chapterNumber = options.chapterNumber;
    this.retryable = options.retryable ?? isLikelyRetryable(options.cause);
    this.cause = options.cause;
  }
}

/** Heurística para determinar si un error subyacente es reintentable. */
function isLikelyRetryable(error: unknown): boolean {
  const msg = String(error);
  const retryablePatterns = ["429", "502", "503", "ECONNRESET", "ETIMEDOUT", "fetch failed", "socket hang up"];
  const nonRetryablePatterns = ["401", "403", "400", "invalid_api_key"];

  for (const p of nonRetryablePatterns) {
    if (msg.includes(p)) return false;
  }
  for (const p of retryablePatterns) {
    if (msg.includes(p)) return true;
  }
  return false;
}

/**
 * Structured API error handling.
 * Ported from PR #96 (Te9ui1a) — typed error codes for consistent JSON responses.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}


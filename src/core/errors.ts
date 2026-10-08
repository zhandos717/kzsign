export type ErrorCode =
  | "BAD_PASSWORD"
  | "UNSUPPORTED_ALGORITHM"
  | "MALFORMED_P12"
  | "NO_KEY"
  | "MALFORMED_CMS"
  | "PIN_LOCKED"
  | "NOT_FOUND"
  | "CANCELED"
  | "TSP_FAILED"
  | "NEED_PASSWORD"
  | "MALFORMED_XML";

export class KzSignError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly retryAfterSec?: number,
  ) {
    super(`${code}: ${message}`);
  }
}
